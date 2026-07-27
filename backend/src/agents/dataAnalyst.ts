import Anthropic from "@anthropic-ai/sdk";
import type { TableSchema } from "../db/schemaReader";
import { schemaToPrompt } from "../db/schemaReader";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface KeyFeature {
  column: string;
  label: string;
  description: string;
  importance: "high" | "medium" | "low";
}

export interface DataUnderstanding {
  domain: string;
  summary: string;
  keyFeatures: KeyFeature[];
  suggestedQuestions: string[];
  primaryMetrics: string[];
}

const UNDERSTANDING_TOOL: Anthropic.Tool = {
  name: "provide_data_understanding",
  description: "Provide a structured understanding of the uploaded dataset.",
  input_schema: {
    type: "object" as const,
    properties: {
      domain: {
        type: "string",
        description: "Domain/industry of this data (e.g. 'E-commerce', 'Healthcare', 'Logistics', 'Finance')",
      },
      summary: {
        type: "string",
        description: "2-3 sentences describing what this dataset contains, its time range or scope if evident, and what kinds of analysis it supports.",
      },
      keyFeatures: {
        type: "array",
        description: "The most important columns. Focus on high-signal columns; skip IDs and internal keys.",
        items: {
          type: "object",
          properties: {
            column: { type: "string", description: "Exact column name as it appears in the schema" },
            label: { type: "string", description: "Human-readable display name (e.g. 'Order Date', 'Revenue')" },
            description: { type: "string", description: "What this column represents and why it matters for analysis" },
            importance: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["column", "label", "description", "importance"],
        },
      },
      suggestedQuestions: {
        type: "array",
        description: "6-8 specific, directly answerable questions about this data. Reference actual column names in your questions.",
        items: { type: "string" },
      },
      primaryMetrics: {
        type: "array",
        description: "The most important numeric columns to measure and aggregate (just column names).",
        items: { type: "string" },
      },
    },
    required: ["domain", "summary", "keyFeatures", "suggestedQuestions", "primaryMetrics"],
  },
};

/** Tool used in Pass 1 of large-schema analysis to identify domain clusters */
const CLUSTERING_TOOL: Anthropic.Tool = {
  name: "identify_clusters",
  description: "Group the provided tables into logical domain clusters.",
  input_schema: {
    type: "object" as const,
    properties: {
      clusters: {
        type: "array",
        description: "Domain clusters found in the schema.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Short cluster label, e.g. 'Orders', 'Auth', 'Product Catalog'" },
            tableNames: {
              type: "array",
              items: { type: "string" },
              description: "Table names that belong to this cluster",
            },
          },
          required: ["name", "tableNames"],
        },
      },
      overallDomain: {
        type: "string",
        description: "Top-level domain/industry that best describes the whole database",
      },
    },
    required: ["clusters", "overallDomain"],
  },
};

const MAX_SAMPLE_ROWS = 3;
const MAX_COLUMNS_PER_TABLE = 30;
const MAX_TABLES_SINGLE_PASS = 30;
const MAX_CLUSTERS = 8;
const MAX_TABLES_PER_CLUSTER = 3;

/** Run single-pass analysis (≤ MAX_TABLES_SINGLE_PASS tables). */
async function singlePassAnalysis(tables: TableSchema[]): Promise<DataUnderstanding> {
  const truncated = tables.slice(0, MAX_TABLES_SINGLE_PASS);
  const schemaText = schemaToPrompt(
    truncated.map((t) => ({
      ...t,
      columns: t.columns.slice(0, MAX_COLUMNS_PER_TABLE),
      sample: t.sample.slice(0, MAX_SAMPLE_ROWS),
    }))
  );
  const tableNote =
    tables.length > MAX_TABLES_SINGLE_PASS
      ? `\n\n(Note: ${tables.length - MAX_TABLES_SINGLE_PASS} additional tables were omitted.)`
      : "";

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    tools: [UNDERSTANDING_TOOL],
    tool_choice: { type: "any" },
    messages: [
      {
        role: "user",
        content: `Analyse this dataset and call provide_data_understanding with your findings.\n\n${schemaText}${tableNote}`,
      },
    ],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "provide_data_understanding"
  );
  if (!toolUse) throw new Error("Data analyst did not return structured understanding");
  const input = toolUse.input as DataUnderstanding;
  if (!input.domain || !input.summary || !Array.isArray(input.suggestedQuestions)) {
    throw new Error("Data analyst returned incomplete understanding");
  }
  return input;
}

/** Pass 1: ask Claude to group table names into domain clusters. */
async function clusterTables(
  tables: TableSchema[]
): Promise<{ clusters: { name: string; tableNames: string[] }[]; overallDomain: string }> {
  const catalogue = tables
    .map((t) => `${t.name} (${t.rowCount.toLocaleString()} rows)`)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    tools: [CLUSTERING_TOOL],
    tool_choice: { type: "any" },
    messages: [
      {
        role: "user",
        content: `Below is a list of database tables. Group them into logical domain clusters and call identify_clusters.\n\n${catalogue}`,
      },
    ],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "identify_clusters"
  );
  if (!toolUse) throw new Error("Clustering did not return structured result");
  return toolUse.input as { clusters: { name: string; tableNames: string[] }[]; overallDomain: string };
}

/** Synthesise multiple per-cluster DataUnderstandings into one. */
function synthesise(
  clusterResults: Array<{ clusterName: string; understanding: DataUnderstanding }>,
  overallDomain: string
): DataUnderstanding {
  const importanceOrder = { high: 0, medium: 1, low: 2 };

  // Pick top 5 features per cluster, dedup by column name
  const seen = new Set<string>();
  const keyFeatures: KeyFeature[] = clusterResults
    .flatMap(({ understanding: u }) =>
      u.keyFeatures
        .sort((a, b) => importanceOrder[a.importance] - importanceOrder[b.importance])
        .slice(0, 5)
    )
    .filter((f) => {
      if (seen.has(f.column)) return false;
      seen.add(f.column);
      return true;
    });

  // 2 questions per cluster, max 8 total
  const suggestedQuestions = clusterResults
    .flatMap(({ understanding: u }) => u.suggestedQuestions.slice(0, 2))
    .slice(0, 8);

  // Union of all primaryMetrics
  const primaryMetrics = [...new Set(clusterResults.flatMap(({ understanding: u }) => u.primaryMetrics))];

  // Combine summaries — up to first sentence from each cluster
  const summaryParts = clusterResults
    .map(({ clusterName, understanding: u }) => `${clusterName}: ${u.summary.split(".")[0]}.`)
    .slice(0, 4);
  const summary = summaryParts.join(" ") + ` Supports cross-domain analysis across ${clusterResults.length} business areas.`;

  return { domain: overallDomain, summary, keyFeatures, suggestedQuestions, primaryMetrics };
}

/** Two-pass clustered analysis for large schemas (> MAX_TABLES_SINGLE_PASS tables). */
async function twoPassAnalysis(tables: TableSchema[]): Promise<DataUnderstanding> {
  const tableMap = new Map(tables.map((t) => [t.name, t]));

  // Pass 1: clustering
  const { clusters, overallDomain } = await clusterTables(tables);
  const topClusters = clusters.slice(0, MAX_CLUSTERS);

  // Pass 2: deep-dive each cluster in parallel
  const clusterResults = await Promise.all(
    topClusters.map(async ({ name, tableNames }) => {
      const clusterTables = tableNames
        .map((n) => tableMap.get(n))
        .filter((t): t is TableSchema => !!t)
        // Pick tables with most columns as most representative
        .sort((a, b) => b.columns.length - a.columns.length)
        .slice(0, MAX_TABLES_PER_CLUSTER);

      if (!clusterTables.length) return null;
      const understanding = await singlePassAnalysis(clusterTables);
      return { clusterName: name, understanding };
    })
  );

  const valid = clusterResults.filter((r): r is { clusterName: string; understanding: DataUnderstanding } => r !== null);
  if (!valid.length) throw new Error("All cluster analyses failed");

  return synthesise(valid, overallDomain);
}

export async function analyzeData(tables: TableSchema[]): Promise<DataUnderstanding> {
  if (tables.length > MAX_TABLES_SINGLE_PASS) {
    try {
      return await twoPassAnalysis(tables);
    } catch (e) {
      // Fallback to single-pass with top tables by row count
      console.warn("[dataAnalyst] Two-pass analysis failed, falling back to single-pass:", e);
      const sorted = [...tables].sort((a, b) => b.rowCount - a.rowCount);
      return await singlePassAnalysis(sorted);
    }
  }
  return singlePassAnalysis(tables);
}
