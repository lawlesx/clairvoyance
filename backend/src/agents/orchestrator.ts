import Anthropic from "@anthropic-ai/sdk";
import type { Database } from "bun:sqlite";
import { getSchema, schemaToPrompt, getAllColumnNames } from "../db/schemaReader";
import { buildSchemaIndex, searchSchema, compactTableIndex } from "../db/schemaIndex";
import { searchTablesByEmbedding } from "../db/tableEmbeddings";
import { validateSQL, GuardrailError, type SqlDialect } from "./guardrails";
import { chooseVisualization, suggestVisualizations } from "./vizSelector";
import type { ChartConfig } from "./vizSelector";
import type { TableSchema } from "../db/schemaReader";
import type { DataUnderstanding } from "./dataAnalyst";
import type { ConnectorInterface, SchemaTable } from "../db/connectors/index";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MAX_ROWS = parseInt(process.env.MAX_ROWS ?? "10000");
const DATA_ROWS_TO_MODEL = Math.min(parseInt(process.env.DATA_ROWS_TO_MODEL ?? "50"), 200);
const MAX_SCHEMA_TABLES_PER_QUERY = parseInt(process.env.MAX_SCHEMA_TABLES_PER_QUERY ?? "20");

export interface AgentStep {
  tool: string;
  input: Record<string, unknown>;
  output: string;
  error?: boolean;
}

export interface AgentResponse {
  answer: string;
  sql?: string;
  data?: Record<string, unknown>[];
  chart?: ChartConfig;
  charts?: ChartConfig[];
  clarificationNeeded?: boolean;
  steps?: AgentStep[];
}

// read_schema removed: schema is already in the system prompt, no round-trip needed
function buildTools(sqlDialect: SqlDialect = "SQLite"): Anthropic.Tool[] {
  const dialectLabel = sqlDialect === "PostgresQL" ? "PostgreSQL" : sqlDialect;
  return [
    {
      name: "generate_sql",
      description: `Generate a SQL SELECT query to answer the user's question. The relevant schema is already available in your system prompt — use it directly.`,
      input_schema: {
        type: "object" as const,
        properties: {
          sql: { type: "string", description: `The SQL SELECT query to execute. Must be a valid ${dialectLabel} SELECT statement.` },
          explanation: { type: "string", description: "Brief explanation of what this query does." },
        },
        required: ["sql", "explanation"],
      },
    },
    {
      name: "execute_query",
      description: "Execute the SQL query and return results. Call this after generate_sql.",
      input_schema: {
        type: "object" as const,
        properties: {
          sql: { type: "string", description: "The SQL SELECT query to run." },
        },
        required: ["sql"],
      },
    },
    {
      name: "lookup_schema",
      description: "Get the full column definitions for a table that wasn't included in your schema view. Use this when you need to query a table you can see listed in the Schema Index but don't have column details for.",
      input_schema: {
        type: "object" as const,
        properties: {
          table_name: { type: "string", description: "Exact table name to look up." },
        },
        required: ["table_name"],
      },
    },
    {
      name: "ask_clarification",
      description: "Ask the user a clarifying question when the query is ambiguous or you cannot determine intent. Do NOT run any SQL in this case.",
      input_schema: {
        type: "object" as const,
        properties: {
          question: { type: "string", description: "The clarifying question to ask the user." },
        },
        required: ["question"],
      },
    },
  ];
}

function buildSystemPrompt(schemaText: string, domainContext?: string, tableIndex?: string, sqlDialect: SqlDialect = "SQLite"): string {
  const contextBlock = domainContext
    ? `\n## Dataset Context\n${domainContext}\n`
    : "";
  const indexBlock = tableIndex
    ? `\n## ${tableIndex}\n`
    : "";
  const dialectNote = sqlDialect === "SQLite"
    ? "Must be a valid SQLite SELECT statement."
    : sqlDialect === "PostgresQL"
    ? "Must be a valid PostgreSQL SELECT statement. Always double-quote mixed-case or PascalCase table and column names (e.g. schema.\"TableName\")."
    : "Must be a valid MySQL SELECT statement.";
  return `You are Clairvoyance, a data intelligence assistant. You help users explore their data through natural language.
${contextBlock}${indexBlock}
## Database Schema (most relevant tables for this query)
${schemaText}

Rules:
- The schema above shows the most relevant tables. If you need a table not listed, call lookup_schema first.
- Only generate SELECT queries. Never INSERT, UPDATE, DELETE, DROP, etc.
- If the question is ambiguous or refers to columns that don't exist, call ask_clarification instead.
- Add LIMIT ${MAX_ROWS} to all queries.
- ${dialectNote}
- When writing SQL, alias computed columns with human-readable names (e.g. SUM(price) AS "Total Revenue").
- Be concise in your final answer. Let the data speak.
- After execute_query returns data, summarise the key insight in 1-3 sentences.`;
}

export type StreamEvent =
  | { type: "tool_start"; tool: string; description: string }
  | { type: "tool_done"; tool: string; summary: string; error?: boolean }
  | { type: "answer"; text: string }
  | { type: "sql"; sql: string }
  | { type: "data"; data: Record<string, unknown>[]; chart: ChartConfig; charts: ChartConfig[] }
  | { type: "done" }
  | { type: "error"; message: string };

const TOOL_DESCRIPTIONS: Record<string, string> = {
  generate_sql: "Writing SQL query…",
  execute_query: "Running query on your data…",
  lookup_schema: "Looking up table schema…",
  ask_clarification: "Asking for clarification…",
};

export async function runAgent(
  db: Database | null,
  question: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = [],
  onEvent?: (event: StreamEvent) => Promise<void>,
  cachedSchema?: TableSchema[],
  cachedUnderstanding?: DataUnderstanding,
  liveConnector?: ConnectorInterface,
  sqlDialect: SqlDialect = "SQLite",
  sessionId?: string
): Promise<AgentResponse> {
  const emit = onEvent ?? (() => Promise.resolve());

  // Schema resolution: live connector → cached → SQLite
  let tables: TableSchema[];
  if (liveConnector) {
    const liveTables = await liveConnector.readSchema();
    tables = liveTables.map((t) => ({
      name: t.tableName,
      columns: t.columns.map((c) => ({ name: c.name, type: c.type, nullable: true })),
      rowCount: t.rowCount,
      sample: [],
    }));
  } else {
    tables = cachedSchema ?? (db ? getSchema(db) : []);
  }

  // Build schema index for contextual injection (used for large schemas and lookup_schema)
  const schemaIndex = buildSchemaIndex(tables);

  // For large schemas, inject only relevant tables via semantic search (vector) with
  // keyword search as fallback when Voyage is unavailable or embeddings not yet built.
  const isLargeSchema = tables.length > MAX_SCHEMA_TABLES_PER_QUERY;
  const queryContext = [question, ...history.slice(-3).map((h) => h.content)].join(" ");

  let relevantTables: TableSchema[];
  if (isLargeSchema) {
    const semantic = sessionId
      ? await searchTablesByEmbedding(sessionId, queryContext, MAX_SCHEMA_TABLES_PER_QUERY, tables)
      : [];
    relevantTables = semantic.length > 0
      ? semantic
      : searchSchema(schemaIndex, queryContext, MAX_SCHEMA_TABLES_PER_QUERY);
  } else {
    relevantTables = tables;
  }

  const tableIndex = isLargeSchema ? compactTableIndex(tables) : undefined;

  const schemaText = schemaToPrompt(relevantTables);
  // allowedCols starts with the relevant tables; expanded dynamically via lookup_schema
  const allowedCols = getAllColumnNames(relevantTables);

  // Understanding comes from the caller — no more sync SQLite hash lookup
  const domainContext = cachedUnderstanding
    ? `Domain: ${cachedUnderstanding.domain}\nSummary: ${cachedUnderstanding.summary}\nKey metrics: ${cachedUnderstanding.primaryMetrics.join(", ")}`
    : undefined;

  const systemPrompt = buildSystemPrompt(schemaText, domainContext, tableIndex, sqlDialect);

  const messages: Anthropic.MessageParam[] = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: question },
  ];

  let finalSql: string | undefined;
  let finalData: Record<string, unknown>[] | undefined;
  let finalAnswer = "";
  let clarificationNeeded = false;
  const steps: AgentStep[] = [];

  // Agentic loop — max 8 turns (extra turns for lookup_schema calls)
  for (let turn = 0; turn < 8; turn++) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      // Prompt caching: Anthropic caches the system prompt KV for ~5 min.
      // Repeated queries with the same schema pay ~10% of normal input token cost.
      system: [{ type: "text" as const, text: systemPrompt, cache_control: { type: "ephemeral" as const } }],
      tools: buildTools(sqlDialect),
      messages,
    });

    for (const block of response.content) {
      if (block.type === "text") finalAnswer = block.text;
    }

    if (response.stop_reason === "end_turn") break;
    if (response.stop_reason !== "tool_use") break;

    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      let result: string;

      // Emit before the tool runs
      await emit({
        type: "tool_start",
        tool: toolUse.name,
        description: TOOL_DESCRIPTIONS[toolUse.name] ?? `Running ${toolUse.name}…`,
      });

      try {
        if (toolUse.name === "generate_sql") {
          const input = toolUse.input as { sql: string; explanation: string };
          try {
            validateSQL(input.sql, allowedCols, sqlDialect);
            result = JSON.stringify({ sql: input.sql, explanation: input.explanation });
            steps.push({ tool: "generate_sql", input: { explanation: input.explanation }, output: input.sql });
            await emit({ type: "tool_done", tool: "generate_sql", summary: input.explanation ?? "SQL generated" });
          } catch (e: any) {
            result = JSON.stringify({ error: e.message });
            steps.push({ tool: "generate_sql", input: { sql: input.sql }, output: e.message, error: true });
            await emit({ type: "tool_done", tool: "generate_sql", summary: e.message, error: true });
          }

        } else if (toolUse.name === "execute_query") {
          const input = toolUse.input as { sql: string };
          try {
            const validatedSql = validateSQL(input.sql, allowedCols, sqlDialect);
            const limitedSql = ensureLimit(validatedSql, MAX_ROWS);
            let rows: Record<string, unknown>[];
            if (liveConnector) {
              rows = await liveConnector.executeQuery(limitedSql);
            } else if (db) {
              rows = db.query(limitedSql).all() as Record<string, unknown>[];
            } else {
              throw new Error("No data source available");
            }
            finalSql = limitedSql;
            finalData = rows;
            const preview = rows.slice(0, DATA_ROWS_TO_MODEL);
            const hiddenRows = rows.length - preview.length;
            result = JSON.stringify({
              rowCount: rows.length,
              data: preview,
              ...(hiddenRows > 0 && { note: `${hiddenRows.toLocaleString()} more rows returned to the user but not shown here` }),
            });
            const summary = `Returned ${rows.length.toLocaleString()} row(s)`;
            steps.push({ tool: "execute_query", input: { sql: limitedSql }, output: summary });
            await emit({ type: "sql", sql: limitedSql });
            await emit({ type: "tool_done", tool: "execute_query", summary });
          } catch (e: any) {
            const msg = e instanceof GuardrailError ? `Guardrail blocked: ${e.message}` : `Query failed: ${e.message}`;
            result = JSON.stringify({ error: msg });
            steps.push({ tool: "execute_query", input: toolUse.input as Record<string, unknown>, output: msg, error: true });
            await emit({ type: "tool_done", tool: "execute_query", summary: msg, error: true });
          }

        } else if (toolUse.name === "lookup_schema") {
          const input = toolUse.input as { table_name: string };
          await emit({ type: "tool_start", tool: "lookup_schema", description: `Looking up schema for "${input.table_name}"…` });
          const found = schemaIndex.tableMap.get(input.table_name);
          if (found) {
            // Expand allowed columns to include this table's columns
            for (const col of found.columns) allowedCols.add(col.name.toLowerCase());
            allowedCols.add(found.name.toLowerCase());
            result = schemaToPrompt([found]);
            steps.push({ tool: "lookup_schema", input: { table_name: input.table_name }, output: `Found: ${found.columns.length} columns` });
            await emit({ type: "tool_done", tool: "lookup_schema", summary: `Schema for "${input.table_name}" loaded` });
          } else {
            result = JSON.stringify({ error: `Table "${input.table_name}" not found in this session` });
            steps.push({ tool: "lookup_schema", input: { table_name: input.table_name }, output: "Not found", error: true });
            await emit({ type: "tool_done", tool: "lookup_schema", summary: `Table "${input.table_name}" not found`, error: true });
          }

        } else if (toolUse.name === "ask_clarification") {
          const input = toolUse.input as { question: string };
          clarificationNeeded = true;
          finalAnswer = input.question;
          result = "Clarification requested. Stop here.";
          steps.push({ tool: "ask_clarification", input: {}, output: input.question });
          await emit({ type: "tool_done", tool: "ask_clarification", summary: input.question });

        } else {
          result = JSON.stringify({ error: "Unknown tool" });
          steps.push({ tool: toolUse.name, input: {}, output: "Unknown tool", error: true });
          await emit({ type: "tool_done", tool: toolUse.name, summary: "Unknown tool", error: true });
        }
      } catch (e: any) {
        result = JSON.stringify({ error: e.message });
        steps.push({ tool: toolUse.name, input: {}, output: e.message, error: true });
        await emit({ type: "tool_done", tool: toolUse.name, summary: e.message, error: true });
      }

      toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: result });
    }

    if (clarificationNeeded) break;

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });
  }

  // Build chart configs
  let chart: ChartConfig | undefined;
  let charts: ChartConfig[] = [];
  if (finalData && finalData.length > 0 && tables.length > 0) {
    const firstRow = finalData[0]!;
    const resultKeys = Object.keys(firstRow);
    const allCols = tables.flatMap((t) => t.columns);
    const resultCols = resultKeys.map((k) => {
      const found = allCols.find((c) => c.name.toLowerCase() === k.toLowerCase());
      return found ?? { name: k, type: inferTypeFromValue(firstRow[k]) };
    });
    charts = suggestVisualizations(finalData, resultCols, question);
    chart = charts[0] ?? chooseVisualization(finalData, resultCols, question);
  }

  // Emit final events
  if (finalAnswer) await emit({ type: "answer", text: finalAnswer });
  if (finalData && chart) await emit({ type: "data", data: finalData, chart, charts });
  await emit({ type: "done" });

  return { answer: finalAnswer, sql: finalSql, data: finalData, chart, charts, clarificationNeeded, steps };
}

function ensureLimit(sql: string, max: number): string {
  if (/\bLIMIT\b/i.test(sql)) return sql;
  return `${sql} LIMIT ${max}`;
}

function inferTypeFromValue(val: unknown): string {
  if (typeof val === "number") return "REAL";
  if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}/.test(val)) return "date";
  return "TEXT";
}
