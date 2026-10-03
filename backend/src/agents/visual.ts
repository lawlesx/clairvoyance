/**
 * Everything about turning a query result into something a non-technical reader
 * can understand: column profiling (by looking at the actual values, not just the
 * column names), friendly labels, number formats, statistics such as correlation,
 * and choosing / validating the visual.
 *
 * The AI proposes a visual and labels via `present_answer`; this module checks the
 * proposal against the real data and falls back to a heuristic when it doesn't fit.
 */

export type VisualType = "kpi" | "bar" | "line" | "area" | "pie" | "scatter" | "table" | "none";
export type ValueFormat = "number" | "currency" | "percent" | "ratio" | "date" | "text";
export type ColumnKind = "number" | "date" | "text";

export interface Visual {
  type: VisualType;
  /** Category / time / x-axis column */
  x?: string;
  /** Measure column(s) */
  y?: string[];
  /** Optional column that splits the measure into several series (long format) */
  series?: string;
  title?: string;
}

export interface ColumnMeta {
  key: string;
  label: string;
  kind: ColumnKind;
  format: ValueFormat;
  /** ISO currency code when format === "currency" */
  currency?: string;
}

export interface Correlation {
  x: string;
  y: string;
  r: number;
  n: number;
  /** Plain-language description, e.g. "strong positive relationship" */
  description: string;
}

export interface ResultStats {
  correlation?: Correlation;
}

type Row = Record<string, unknown>;

const ISO_DATE_RE = /^\d{4}-\d{2}(-\d{2})?([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const NUMERIC_STRING_RE = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const ID_NAME_RE = /(^id$|_id$|[a-z]Id$|^uuid$|_uuid$|_key$|^key$|code$|zip|postal|phone)/i;
const YEAR_NAME_RE = /(^|_|\b)(year|yr|fiscal_year)($|_|\b)/i;

// ── Value helpers ─────────────────────────────────────────────────────────────

export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && NUMERIC_STRING_RE.test(v.trim())) return Number(v);
  return null;
}

function isDateValue(v: unknown): boolean {
  if (v instanceof Date) return !isNaN(v.getTime());
  return typeof v === "string" && ISO_DATE_RE.test(v.trim());
}

/** Convert a snake_case / camelCase identifier into a readable label. */
export function toLabel(col: string): string {
  const cleaned = col
    .replace(/^"+|"+$/g, "")
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return col;
  const label = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return label.replace(/\bid\b/gi, "ID").replace(/\burl\b/gi, "URL");
}

// ── Row normalisation ─────────────────────────────────────────────────────────

/**
 * Make rows JSON-friendly and consistent: Dates → ISO strings, bigint → number,
 * numeric strings (Postgres NUMERIC / BIGINT, MySQL DECIMAL) → numbers when the
 * whole column is numeric and doesn't look like an identifier with leading zeros.
 */
export function normalizeRows(rows: Row[]): Row[] {
  if (!rows.length) return rows;
  const keys = Object.keys(rows[0]!);
  const numericStringCols = new Set<string>();

  for (const key of keys) {
    let sawString = false;
    let allNumeric = true;
    for (const row of rows.slice(0, 500)) {
      const v = row[key];
      if (v == null || typeof v === "number" || typeof v === "bigint") continue;
      if (typeof v === "string" && NUMERIC_STRING_RE.test(v.trim()) && !/^0\d/.test(v.trim())) {
        sawString = true;
        continue;
      }
      allNumeric = false;
      break;
    }
    if (sawString && allNumeric && !ID_NAME_RE.test(key)) numericStringCols.add(key);
  }

  return rows.map((row) => {
    const out: Row = {};
    for (const key of keys) {
      const v = row[key];
      if (v instanceof Date) out[key] = isNaN(v.getTime()) ? null : v.toISOString();
      else if (typeof v === "bigint") out[key] = Number(v);
      else if (numericStringCols.has(key) && typeof v === "string") out[key] = Number(v);
      else if (v !== null && typeof v === "object" && !(v instanceof Array)) out[key] = JSON.stringify(v);
      else out[key] = v;
    }
    return out;
  });
}

// ── Column profiling ──────────────────────────────────────────────────────────

export function profileColumns(rows: Row[]): ColumnMeta[] {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]!);
  const sample = rows.slice(0, 500);

  return keys.map((key) => {
    const values = sample.map((r) => r[key]).filter((v) => v != null && v !== "");
    let kind: ColumnKind = "text";

    if (values.length && values.every((v) => toNumber(v) !== null)) {
      const nums = values.map((v) => toNumber(v)!);
      const looksLikeYear =
        YEAR_NAME_RE.test(key) && nums.every((n) => Number.isInteger(n) && n >= 1900 && n <= 2100);
      if (looksLikeYear) kind = "date";
      else if (ID_NAME_RE.test(key)) kind = "text";
      else kind = "number";
    } else if (values.length && values.every(isDateValue)) {
      kind = "date";
    }

    return { key, label: toLabel(key), kind, format: guessFormat(key, kind) };
  });
}

function guessFormat(key: string, kind: ColumnKind): ValueFormat {
  if (kind === "date") return "date";
  if (kind === "text") return "text";
  if (/(percent|pct|percentage)/i.test(key)) return "percent";
  return "number";
}

/**
 * Merge the AI's labels/formats onto the profiled columns. The profile wins on
 * `kind` (it is derived from real values); the AI wins on wording and format.
 */
export function mergeColumnMeta(
  profiled: ColumnMeta[],
  proposed: Array<Partial<ColumnMeta> & { key: string }> | undefined
): ColumnMeta[] {
  if (!proposed?.length) return profiled;
  const byKey = new Map(proposed.map((p) => [p.key.toLowerCase(), p]));
  const validFormats: ValueFormat[] = ["number", "currency", "percent", "ratio", "date", "text"];

  return profiled.map((col) => {
    const p = byKey.get(col.key.toLowerCase());
    if (!p) return col;
    let format = p.format && validFormats.includes(p.format) ? p.format : col.format;
    // Don't let a numeric format be applied to text, or vice versa.
    const numericFormat = format === "number" || format === "currency" || format === "percent" || format === "ratio";
    if (col.kind !== "number" && numericFormat) format = col.format;
    if (col.kind === "number" && !numericFormat) format = col.format;
    return {
      ...col,
      label: typeof p.label === "string" && p.label.trim() ? p.label.trim().slice(0, 60) : col.label,
      format,
      ...(format === "currency" ? { currency: (p.currency || "USD").toUpperCase().slice(0, 3) } : {}),
    };
  });
}

// ── Statistics ────────────────────────────────────────────────────────────────

export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]!; sy += ys[i]!; }
  const mx = sx / n, my = sy / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx, b = ys[i]! - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

export function describeCorrelation(r: number): string {
  const a = Math.abs(r);
  const strength = a < 0.1 ? "no meaningful" : a < 0.3 ? "a weak" : a < 0.5 ? "a moderate" : a < 0.7 ? "a strong" : "a very strong";
  if (a < 0.1) return "no meaningful relationship";
  return `${strength} ${r > 0 ? "positive" : "negative"} relationship`;
}

export function correlationFor(rows: Row[], x: string, y: string): Correlation | undefined {
  const xs: number[] = [], ys: number[] = [];
  for (const row of rows) {
    const a = toNumber(row[x]), b = toNumber(row[y]);
    if (a === null || b === null) continue;
    xs.push(a); ys.push(b);
  }
  const r = pearson(xs, ys);
  if (r === null || xs.length < 5) return undefined;
  return { x, y, r: Math.round(r * 1000) / 1000, n: xs.length, description: describeCorrelation(r) };
}

/** A compact numeric summary per column, given to the model so its numbers are exact. */
export function summarizeForModel(rows: Row[], cols: ColumnMeta[]) {
  const summary: Record<string, unknown> = {};
  for (const col of cols) {
    if (col.kind === "number") {
      const nums = rows.map((r) => toNumber(r[col.key])).filter((n): n is number => n !== null);
      if (!nums.length) continue;
      const sum = nums.reduce((a, b) => a + b, 0);
      summary[col.key] = {
        min: Math.min(...nums), max: Math.max(...nums),
        sum: round(sum), average: round(sum / nums.length), count: nums.length,
      };
    } else {
      const distinct = new Set(rows.map((r) => String(r[col.key] ?? ""))).size;
      summary[col.key] = { distinctValues: distinct };
    }
  }
  const numeric = cols.filter((c) => c.kind === "number");
  if (numeric.length >= 2) {
    const corr = correlationFor(rows, numeric[0]!.key, numeric[1]!.key);
    if (corr) summary["_correlation"] = corr;
  }
  return summary;
}

function round(n: number): number {
  return Math.abs(n) >= 100 ? Math.round(n * 100) / 100 : Math.round(n * 10000) / 10000;
}

// ── Choosing a visual ─────────────────────────────────────────────────────────

const PART_OF_WHOLE_RE = /share|proportion|percentage|breakdown|split|composition|distribution|mix/i;
const CUMULATIVE_RE = /cumulative|running total|over time.*total|growth/i;

function distinctCount(rows: Row[], key: string): number {
  return new Set(rows.map((r) => String(r[key]))).size;
}

/** Heuristic choice used when the AI's proposal is missing or doesn't fit the data. */
export function suggestVisual(rows: Row[], cols: ColumnMeta[], question = ""): Visual {
  if (!rows.length || !cols.length) return { type: "none" };

  const nums = cols.filter((c) => c.kind === "number");
  const dates = cols.filter((c) => c.kind === "date");
  const texts = cols.filter((c) => c.kind === "text");

  if (rows.length === 1) {
    return nums.length ? { type: "kpi", y: nums.slice(0, 4).map((c) => c.key) } : { type: "table" };
  }
  if (!nums.length) return { type: "table" };

  // Change over time
  if (dates.length) {
    const x = dates[0]!.key;
    const lowCardText = texts.find((t) => distinctCount(rows, t.key) <= 8);
    if (lowCardText && nums.length >= 1) {
      return { type: "line", x, y: [nums[0]!.key], series: lowCardText.key };
    }
    // Repeated dates without a series column means un-aggregated records → table.
    if (distinctCount(rows, x) < rows.length * 0.9) return { type: "table" };
    const y = nums.slice(0, 4).map((c) => c.key);
    return { type: y.length === 1 && CUMULATIVE_RE.test(question) ? "area" : "line", x, y };
  }

  // Relationship between two measures
  if (nums.length >= 2 && texts.length === 0 && rows.length >= 5) {
    return { type: "scatter", x: nums[0]!.key, y: [nums[1]!.key] };
  }

  if (texts.length) {
    const x = texts[0]!.key;
    const categories = distinctCount(rows, x);
    // Two categorical columns + one measure → grouped bars.
    if (texts.length >= 2 && nums.length === 1) {
      const series = texts[1]!.key;
      if (distinctCount(rows, series) <= 6 && categories <= 20) {
        return { type: "bar", x, y: [nums[0]!.key], series };
      }
    }
    if (
      nums.length === 1 && categories === rows.length && rows.length <= 6 &&
      PART_OF_WHOLE_RE.test(question) &&
      rows.every((r) => (toNumber(r[nums[0]!.key]) ?? -1) >= 0)
    ) {
      return { type: "pie", x, y: [nums[0]!.key] };
    }
    // A long list of individual records isn't a chart — show a table.
    if (categories !== rows.length && categories > 30) return { type: "table" };
    return { type: "bar", x, y: nums.slice(0, 3).map((c) => c.key) };
  }

  return { type: "table" };
}

/**
 * Check an AI-proposed visual against the actual data. Returns the proposal when it
 * is renderable, otherwise null so the caller can fall back to `suggestVisual`.
 */
export function validateVisual(v: Partial<Visual> | undefined, rows: Row[], cols: ColumnMeta[]): Visual | null {
  if (!v?.type) return null;
  const types: VisualType[] = ["kpi", "bar", "line", "area", "pie", "scatter", "table", "none"];
  if (!types.includes(v.type)) return null;
  if (v.type === "table" || v.type === "none") return { type: v.type, title: v.title };
  if (!rows.length) return null;

  const byKey = new Map(cols.map((c) => [c.key.toLowerCase(), c]));
  const resolve = (k?: string) => (k ? byKey.get(k.toLowerCase()) : undefined);
  const y = (v.y ?? []).map(resolve).filter((c): c is ColumnMeta => !!c && c.kind === "number");
  if (!y.length) return null;
  const yKeys = y.slice(0, v.type === "kpi" ? 4 : 5).map((c) => c.key);

  if (v.type === "kpi") return rows.length <= 3 ? { type: "kpi", y: yKeys, title: v.title } : null;

  const x = resolve(v.x);
  if (!x || yKeys.includes(x.key)) return null;
  const series = resolve(v.series);
  const seriesKey = series && series.key !== x.key && !yKeys.includes(series.key) ? series.key : undefined;

  switch (v.type) {
    case "scatter":
      if (x.kind !== "number" || rows.length < 3) return null;
      return { type: "scatter", x: x.key, y: [yKeys[0]!], title: v.title };
    case "pie": {
      if (rows.length > 8 || seriesKey) return null;
      const allPositive = rows.every((r) => (toNumber(r[yKeys[0]!]) ?? -1) >= 0);
      return allPositive ? { type: "pie", x: x.key, y: [yKeys[0]!], title: v.title } : null;
    }
    case "line":
    case "area":
      if (rows.length < 2) return null;
      return { type: v.type, x: x.key, y: seriesKey ? [yKeys[0]!] : yKeys, series: seriesKey, title: v.title };
    case "bar":
      return { type: "bar", x: x.key, y: seriesKey ? [yKeys[0]!] : yKeys, series: seriesKey, title: v.title };
    default:
      return null;
  }
}

// ── The assembled answer ──────────────────────────────────────────────────────

export const MAX_CLIENT_ROWS = parseInt(process.env.MAX_CLIENT_ROWS ?? "1000");

export interface AnswerPayload {
  headline: string;
  insights: string[];
  method?: string;
  followUps: string[];
  visual: Visual;
  columns: ColumnMeta[];
  data: Row[];
  totalRows: number;
  truncated: boolean;
  stats?: ResultStats;
  sql?: string;
  clarification?: { question: string; options: string[] };
}

export function buildAnswer(opts: {
  headline: string;
  insights?: string[];
  method?: string;
  followUps?: string[];
  proposedVisual?: Partial<Visual>;
  proposedColumns?: Array<Partial<ColumnMeta> & { key: string }>;
  rows?: Row[];
  sql?: string;
  question: string;
}): AnswerPayload {
  const rows = opts.rows ?? [];
  const profiled = profileColumns(rows);
  const columns = mergeColumnMeta(profiled, opts.proposedColumns);
  const visual = validateVisual(opts.proposedVisual, rows, columns) ?? suggestVisual(rows, columns, opts.question);

  let stats: ResultStats | undefined;
  if (visual.type === "scatter" && visual.x && visual.y?.[0]) {
    const correlation = correlationFor(rows, visual.x, visual.y[0]);
    if (correlation) stats = { correlation };
  }

  return {
    headline: opts.headline.trim(),
    insights: (opts.insights ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 5),
    method: opts.method?.trim() || undefined,
    followUps: (opts.followUps ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 3),
    visual,
    columns,
    data: rows.slice(0, MAX_CLIENT_ROWS),
    totalRows: rows.length,
    truncated: rows.length > MAX_CLIENT_ROWS,
    stats,
    sql: opts.sql,
  };
}

/** Markdown rendering of an answer — stored for search and used by older clients. */
export function answerToMarkdown(a: Pick<AnswerPayload, "headline" | "insights">): string {
  return [a.headline, ...a.insights.map((i) => `- ${i}`)].join("\n");
}

