import type { TableSchema } from "../db/schemaReader";
import { schemaToPrompt } from "../db/schemaReader";
import { createJSON } from "../lib/llm";

/**
 * "Getting to know your data": one short pass that produces a plain-language
 * description of a dataset, the business concepts it contains, and starter
 * questions — written for a PM or business analyst, not a DBA.
 */

export interface KeyFeature {
  /** Exact column (or table.column) the concept maps to — used by the query agent, never shown raw */
  column: string;
  /** Business-friendly name, e.g. "Order value" */
  label: string;
  description: string;
  importance: "high" | "medium" | "low";
}

export interface DataArea {
  name: string;
  description: string;
}

export interface DataUnderstanding {
  domain: string;
  summary: string;
  keyFeatures: KeyFeature[];
  suggestedQuestions: string[];
  primaryMetrics: string[];
  /** Topic areas — mostly useful for large databases */
  areas?: DataArea[];
}

export type RowSampler = (table: TableSchema) => Promise<Record<string, unknown>[]>;

const AUDIENCE = `You are helping business users — product managers, analysts, operations and
finance people — who do NOT know SQL or how the database is organised. Write everything
in plain business language. Never mention tables, columns, schemas, joins, IDs, foreign
keys, or snake_case names in user-facing text (summary, labels, descriptions, questions,
area names). Describe what the data lets someone learn about the business.`;

const UNDERSTANDING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["domain", "summary", "keyFeatures", "suggestedQuestions", "primaryMetrics", "areas"],
  properties: {
    domain: { type: "string", description: "Short business domain, e.g. 'E-commerce sales', 'SaaS subscriptions'." },
    summary: {
      type: "string",
      description: "2-3 plain-language sentences: what this data is about, the time span if evident, and what it can answer.",
    },
    keyFeatures: {
      type: "array",
      description: "5-10 most useful business concepts in the data (skip IDs and technical fields).",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["column", "label", "description", "importance"],
        properties: {
          column: { type: "string", description: "Exact column name (prefix with table name and a dot when there are several tables)." },
          label: { type: "string", description: "Friendly name, e.g. 'Order value', 'Signup date', 'Customer region'." },
          description: { type: "string", description: "One short sentence on what it means and why it matters." },
          importance: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
    suggestedQuestions: {
      type: "array",
      description:
        "6-8 questions a business person would actually ask, answerable from this data, in natural wording without technical names. Mix: a trend over time, a top/bottom ranking, a comparison between groups, a relationship between two measures, and a single headline number.",
      items: { type: "string" },
    },
    primaryMetrics: {
      type: "array",
      description: "Exact column names of the most important numeric measures.",
      items: { type: "string" },
    },
    areas: {
      type: "array",
      description: "2-8 topic areas the data covers (e.g. 'Sales', 'Customers', 'Inventory'). Empty for a single simple table.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description"],
        properties: { name: { type: "string" }, description: { type: "string" } },
      },
    },
  },
};

const CLUSTER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overallDomain", "clusters"],
  properties: {
    overallDomain: { type: "string" },
    clusters: {
      type: "array",
      description: "Up to 8 business areas, most important first.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description", "keyTables"],
        properties: {
          name: { type: "string", description: "Business-friendly area name, e.g. 'Orders & revenue'." },
          description: { type: "string" },
          keyTables: {
            type: "array",
            description: "Up to 5 exact table names that best represent this area (most important first).",
            items: { type: "string" },
          },
        },
      },
    },
  },
};

const MAX_TABLES_SINGLE_PASS = 30;
const MAX_COLUMNS_PER_TABLE = 40;
const MAX_CLUSTERS = 6;
const MAX_TABLES_PER_CLUSTER = 4;
const MAX_TABLES_IN_CATALOGUE = 800;

async function withSamples(tables: TableSchema[], sampler?: RowSampler): Promise<TableSchema[]> {
  if (!sampler) return tables;
  const out: TableSchema[] = [];
  // Small concurrency limit — this is someone's production database.
  for (let i = 0; i < tables.length; i += 4) {
    const batch = await Promise.all(
      tables.slice(i, i + 4).map(async (t) => {
        if (t.sample.length) return t;
        const sample = await Promise.race([
          sampler(t).catch(() => []),
          new Promise<Record<string, unknown>[]>((r) => setTimeout(() => r([]), 8000)),
        ]);
        return { ...t, sample };
      })
    );
    out.push(...batch);
  }
  return out;
}

function sanitize(u: DataUnderstanding): DataUnderstanding {
  return {
    domain: u.domain?.trim() || "Your data",
    summary: u.summary?.trim() || "",
    keyFeatures: (u.keyFeatures ?? []).slice(0, 12),
    suggestedQuestions: (u.suggestedQuestions ?? []).map((q) => q.trim()).filter(Boolean).slice(0, 8),
    primaryMetrics: u.primaryMetrics ?? [],
    areas: (u.areas ?? []).slice(0, 8),
  };
}

async function singlePassAnalysis(tables: TableSchema[], note = ""): Promise<DataUnderstanding> {
  const schemaText = schemaToPrompt(
    tables.map((t) => ({ ...t, columns: t.columns.slice(0, MAX_COLUMNS_PER_TABLE) })),
    { samples: 3 }
  );
  const result = await createJSON<DataUnderstanding>({
    system: AUDIENCE,
    prompt: `Here is a dataset${note}. Describe it for a business user.\n\n${schemaText}`,
    schema: UNDERSTANDING_SCHEMA,
  });
  return sanitize(result);
}

async function clusterTables(tables: TableSchema[]) {
  const sorted = [...tables].sort((a, b) => b.rowCount - a.rowCount);
  const detailed = sorted.slice(0, MAX_TABLES_IN_CATALOGUE).map(
    (t) => `${t.name} (~${t.rowCount.toLocaleString()} rows): ${t.columns.slice(0, 12).map((c) => c.name).join(", ")}`
  );
  const rest = sorted.slice(MAX_TABLES_IN_CATALOGUE).map((t) => t.name);
  const catalogue = detailed.join("\n") + (rest.length ? `\n\nOther tables: ${rest.join(", ")}` : "");

  return createJSON<{ overallDomain: string; clusters: { name: string; description: string; keyTables: string[] }[] }>({
    system: AUDIENCE,
    prompt: `This database has ${tables.length} tables. Group them into business areas and pick the most representative tables for each. Ignore technical tables (migrations, logs, audit, sessions, caches) unless they hold real business activity.\n\n${catalogue}`,
    schema: CLUSTER_SCHEMA,
  });
}

/** Large databases: find the business areas, study each one, then write one coherent overview. */
async function multiPassAnalysis(tables: TableSchema[], sampler?: RowSampler): Promise<DataUnderstanding> {
  const tableMap = new Map(tables.map((t) => [t.name.toLowerCase(), t]));
  const { overallDomain, clusters } = await clusterTables(tables);

  const studied = await Promise.all(
    clusters.slice(0, MAX_CLUSTERS).map(async (cluster) => {
      const picked = cluster.keyTables
        .map((n) => tableMap.get(n.toLowerCase()))
        .filter((t): t is TableSchema => !!t)
        .slice(0, MAX_TABLES_PER_CLUSTER);
      if (!picked.length) return null;
      try {
        const u = await singlePassAnalysis(await withSamples(picked, sampler), ` (the "${cluster.name}" area of a larger ${overallDomain} database)`);
        return { cluster, u };
      } catch {
        return null;
      }
    })
  );
  const valid = studied.filter((s): s is NonNullable<typeof s> => !!s);
  if (!valid.length) throw new Error("Could not analyse any area of this database");

  const notes = valid
    .map(({ cluster, u }) =>
      `## ${cluster.name}\n${u.summary}\nConcepts: ${u.keyFeatures.map((f) => `${f.label} [${f.column}] (${f.importance}) — ${f.description}`).join("; ")}\nQuestions: ${u.suggestedQuestions.join(" | ")}\nMetrics: ${u.primaryMetrics.join(", ")}`
    )
    .join("\n\n");

  try {
    const merged = await createJSON<DataUnderstanding>({
      system: AUDIENCE,
      prompt: `A ${overallDomain} database with ${tables.length} tables was studied area by area. Merge these notes into one overview for a business user. Keep exact column references in keyFeatures.column and primaryMetrics. Prefer questions that span areas when they make sense.\n\n${notes}`,
      schema: UNDERSTANDING_SCHEMA,
    });
    return sanitize(merged);
  } catch {
    // Deterministic merge if the synthesis call fails.
    return sanitize({
      domain: overallDomain,
      summary: valid.map(({ u }) => u.summary.split(". ")[0]).slice(0, 3).join(". ") + ".",
      keyFeatures: valid.flatMap(({ u }) => u.keyFeatures.filter((f) => f.importance === "high").slice(0, 3)),
      suggestedQuestions: valid.flatMap(({ u }) => u.suggestedQuestions.slice(0, 2)),
      primaryMetrics: [...new Set(valid.flatMap(({ u }) => u.primaryMetrics))],
      areas: valid.map(({ cluster }) => ({ name: cluster.name, description: cluster.description })),
    });
  }
}

export async function analyzeData(tables: TableSchema[], opts: { sampler?: RowSampler } = {}): Promise<DataUnderstanding> {
  if (tables.length > MAX_TABLES_SINGLE_PASS) {
    return multiPassAnalysis(tables, opts.sampler);
  }
  return singlePassAnalysis(await withSamples(tables, opts.sampler));
}
