import { describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";

/**
 * End-to-end test of the agent loop against a real SQLite dataset, with Claude
 * replaced by a scripted sequence of tool calls. Verifies the plumbing: SQL
 * guardrails, execution, numeric normalisation, visual validation, status events.
 */

process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:1/unused"; // pg pool is never used here

type Block = { type: "tool_use"; id: string; name: string; input: unknown } | { type: "text"; text: string };
let script: Block[][] = [];
const requests: any[] = [];

mock.module("../lib/llm", () => ({
  MODEL: "test-model",
  responseText: (m: { content: Block[] }) =>
    m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n"),
  createMessage: async (params: any) => {
    requests.push(structuredClone(params));
    const content = script.shift() ?? [{ type: "text", text: "done" }];
    return { content, stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn" };
  },
}));

const { runAgent } = await import("./orchestrator");
const { getSchema } = await import("../db/schemaReader");

function makeSource() {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE sales ("order_month" TEXT, region TEXT, revenue REAL, ad_spend REAL)`);
  const months = ["2024-01", "2024-02", "2024-03", "2024-04", "2024-05", "2024-06"];
  months.forEach((m, i) => {
    db.run(`INSERT INTO sales VALUES (?, 'EU', ?, ?)`, [m, 100 + i * 20, 10 + i * 2]);
    db.run(`INSERT INTO sales VALUES (?, 'US', ?, ?)`, [m, 150 + i * 10, 15 + i]);
  });
  return { kind: "csv" as const, db, tables: getSchema(db), dialect: "SQLite" as const };
}

describe("runAgent", () => {
  test("runs the query, validates the visual and returns a plain-language answer", async () => {
    requests.length = 0;
    script = [
      [{ type: "tool_use", id: "t1", name: "run_query", input: { sql: "SELECT order_month AS month, SUM(revenue) AS total_revenue FROM sales GROUP BY 1 ORDER BY 1" } }],
      [{
        type: "tool_use", id: "t2", name: "present_answer", input: {
          headline: "Revenue grew every month, from $250 in January to $400 in June.",
          insights: ["June was the best month."],
          visual: { type: "line", x: "month", y: ["total_revenue"], title: "Monthly revenue" },
          columns: [{ key: "month", label: "Month", format: "date" }, { key: "total_revenue", label: "Revenue", format: "currency", currency: "USD" }],
          method: "Added up revenue for each month.",
          follow_ups: ["Which region grew fastest?"],
        },
      }],
    ];
    const events: any[] = [];
    const answer = await runAgent({ question: "How is revenue trending?", source: makeSource(), onEvent: async (e) => { events.push(e); } });

    expect(answer.headline).toStartWith("Revenue grew");
    expect(answer.visual).toMatchObject({ type: "line", x: "month", y: ["total_revenue"] });
    expect(answer.data).toHaveLength(6);
    expect(answer.columns.find((c) => c.key === "total_revenue")).toMatchObject({ label: "Revenue", format: "currency" });
    expect(answer.sql).toContain("GROUP BY");
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["status", "sql", "result", "done"]));

    // The model got the result summary (exact totals) back from run_query.
    const toolResult = requests[1].messages.at(-1).content[0];
    expect(JSON.parse(toolResult.content).summary.total_revenue.sum).toBe(1950);
    // System prompt carries the plain-language rules and the schema.
    expect(requests[0].system[0].text).toContain("Never mention SQL");
    expect(requests[0].system[0].text).toContain("Table sales");
  });

  test("feeds SQL errors back so the model can retry, and blocks writes", async () => {
    script = [
      [{ type: "tool_use", id: "a", name: "run_query", input: { sql: "DELETE FROM sales" } }],
      [{ type: "tool_use", id: "b", name: "run_query", input: { sql: "SELECT profit FROM sales" } }],
      [{ type: "tool_use", id: "c", name: "run_query", input: { sql: "SELECT region, ad_spend, revenue FROM sales" } }],
      [{ type: "tool_use", id: "d", name: "present_answer", input: {
        headline: "Spend and revenue move together.", visual: { type: "scatter", x: "ad_spend", y: ["revenue"] }, columns: [], follow_ups: [],
      } }],
    ];
    requests.length = 0;
    const answer = await runAgent({ question: "Is ad spend correlated with revenue?", source: makeSource() });
    const firstResult = requests[1].messages.at(-1).content[0];
    expect(firstResult.is_error).toBe(true);
    expect(firstResult.content).toContain("Rejected");
    const secondResult = requests[2].messages.at(-1).content[0];
    expect(secondResult.content).toContain("profit");
    expect(answer.visual.type).toBe("scatter");
    expect(answer.stats?.correlation?.n).toBe(12);
  });

  test("falls back gracefully when the model answers in plain text", async () => {
    script = [
      [{ type: "tool_use", id: "x", name: "run_query", input: { sql: "SELECT region, SUM(revenue) AS revenue FROM sales GROUP BY region" } }],
      [{ type: "text", text: "US leads with $1,050 in revenue." }],
    ];
    const answer = await runAgent({ question: "Revenue by region", source: makeSource() });
    expect(answer.headline).toBe("US leads with $1,050 in revenue.");
    expect(answer.visual).toEqual({ type: "bar", x: "region", y: ["revenue"] });
  });

  test("clarification carries clickable options", async () => {
    script = [[{ type: "tool_use", id: "q", name: "ask_clarification", input: { question: "Revenue before or after refunds?", options: ["Before", "After"] } }]];
    const answer = await runAgent({ question: "What's revenue?", source: makeSource() });
    expect(answer.clarification).toEqual({ question: "Revenue before or after refunds?", options: ["Before", "After"] });
  });

  test("passes earlier SQL along with follow-up questions", async () => {
    requests.length = 0;
    script = [[{ type: "text", text: "ok" }]];
    await runAgent({
      question: "now split by region",
      history: [{ role: "user", content: "monthly revenue" }, { role: "assistant", content: "Revenue grew.", sql: "SELECT 1" }],
      source: makeSource(),
    });
    expect(requests[0].messages[1].content).toContain("[Data used for that answer: SELECT 1]");
  });
});
