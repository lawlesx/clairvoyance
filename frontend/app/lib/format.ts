import type { ColumnMeta, Row } from "./api";

/**
 * Display formatting for answers: numbers, money, percentages and dates, all
 * rendered the way a business reader expects ("$1.2M", "34%", "Mar 2024").
 */

/** Categorical order validated for colour-vision deficiency (mirrors --color-series-* in globals.css). */
export const SERIES_COLORS = ["#2e8a57", "#2f6fc0", "#e0662f", "#13998f", "#6a4fb3", "#d24b3e", "#d49a00", "#c4508a"];
export const OTHER_COLOR = "#a8aca4";

// ── Dates ─────────────────────────────────────────────────────────────────────

const ISO_RE = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/;

export type DateGrain = "year" | "quarter" | "month" | "day" | "datetime";

/** Parse dates the way the data means them: "2024-03" is March, "2024-03-15" is that day (no timezone shift). */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" && Number.isInteger(value) && value >= 1900 && value <= 2100) {
    return new Date(Date.UTC(value, 0, 1));
  }
  if (typeof value !== "string") return null;
  const m = value.trim().match(ISO_RE);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, tz] = m;
  if (!mo && value.trim().length !== 4) return null;
  if (h && tz) {
    const dt = new Date(value);
    return isNaN(dt.getTime()) ? null : dt;
  }
  return new Date(Date.UTC(Number(y), Number(mo ?? 1) - 1, Number(d ?? 1), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0)));
}

/** Work out whether a set of dates are years, months, days… so labels say "Mar 2024", not "Mar 1". */
export function detectGrain(values: unknown[]): DateGrain {
  const dates = values.map(toDate).filter((d): d is Date => !!d).slice(0, 200);
  if (!dates.length) return "day";
  const midnight = dates.every((d) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0);
  if (!midnight) return "datetime";
  if (dates.every((d) => d.getUTCDate() === 1)) {
    if (dates.every((d) => d.getUTCMonth() === 0)) return "year";
    if (dates.every((d) => d.getUTCMonth() % 3 === 0) && dates.length > 2) return "quarter";
    return "month";
  }
  return "day";
}

/**
 * @param short   compact form for axis ticks
 * @param oneYear all values share a year, so the year can be left off short labels
 */
export function formatDateValue(value: unknown, grain: DateGrain = "day", short = false, oneYear = false): string {
  const d = toDate(value);
  if (!d) return String(value ?? "");
  if (short && grain === "month") {
    const month = new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" }).format(d);
    // "Feb '24", never "Feb 24" (which reads like the 24th of February)
    return oneYear ? month : `${month} \u2019${String(d.getUTCFullYear()).slice(2)}`;
  }
  const opts: Intl.DateTimeFormatOptions = { timeZone: "UTC" };
  switch (grain) {
    case "year":
      return String(d.getUTCFullYear());
    case "quarter":
      return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
    case "month":
      Object.assign(opts, { month: "short", year: "numeric" });
      break;
    case "datetime":
      Object.assign(opts, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      break;
    default:
      Object.assign(opts, short && oneYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: short ? "2-digit" : "numeric" });
  }
  return new Intl.DateTimeFormat(undefined, opts).format(d);
}

// ── Numbers ───────────────────────────────────────────────────────────────────

export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  return null;
}

function currencySymbolFormatter(currency: string, compact: boolean, maxFrac: number) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: maxFrac,
      minimumFractionDigits: 0,
    });
  } catch {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", notation: compact ? "compact" : "standard", maximumFractionDigits: maxFrac });
  }
}

export interface FormatOptions {
  /** 1.2K / 3.4M style (axis ticks, KPI tiles) */
  compact?: boolean;
  grain?: DateGrain;
  short?: boolean;
}

export function formatValue(value: unknown, col: Pick<ColumnMeta, "format" | "kind" | "currency"> | undefined, opts: FormatOptions = {}): string {
  if (value === null || value === undefined || value === "") return "—";
  const format = col?.format ?? "text";

  if (format === "date" || col?.kind === "date") return formatDateValue(value, opts.grain ?? detectGrain([value]), opts.short);

  const n = toNumber(value);
  if (n === null || format === "text") {
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value);
  }

  const abs = Math.abs(n);
  const compact = opts.compact && abs >= 10_000;
  switch (format) {
    case "currency":
      return currencySymbolFormatter(col?.currency || "USD", !!compact, compact ? 1 : abs >= 1000 ? 0 : 2).format(n);
    case "percent":
      return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: abs < 10 ? 1 : 0 }).format(n)}%`;
    case "ratio":
      return new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: abs < 0.1 ? 1 : 0 }).format(n);
    default:
      return new Intl.NumberFormat(undefined, {
        notation: compact ? "compact" : "standard",
        maximumFractionDigits: compact ? 1 : abs >= 100 ? 0 : abs >= 1 ? 2 : 3,
      }).format(n);
  }
}

// ── Columns (for older answers that arrived without metadata) ─────────────────

export function humanize(key: string): string {
  const s = key.replace(/[_\-.]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : key;
}

export function inferColumns(rows: Row[]): ColumnMeta[] {
  if (!rows.length) return [];
  return Object.keys(rows[0]!).map((key) => {
    const values = rows.slice(0, 200).map((r) => r[key]).filter((v) => v != null && v !== "");
    let kind: ColumnMeta["kind"] = "text";
    if (values.length && values.every((v) => toNumber(v) !== null) && !/(^id$|_id$)/i.test(key)) kind = "number";
    else if (values.length && values.every((v) => typeof v === "string" && toDate(v))) kind = "date";
    return { key, label: humanize(key), kind, format: kind === "number" ? "number" : kind === "date" ? "date" : "text" };
  });
}

/** Columns for an answer: its own metadata, filled in for any keys it lacks. */
export function columnsFor(rows: Row[], given: ColumnMeta[]): ColumnMeta[] {
  if (!rows.length) return given;
  const inferred = inferColumns(rows);
  if (!given.length) return inferred;
  const byKey = new Map(given.map((c) => [c.key, c]));
  return inferred.map((c) => byKey.get(c.key) ?? c);
}

// ── CSV export ────────────────────────────────────────────────────────────────

export function downloadCSV(rows: Row[], columns: ColumnMeta[], filename: string) {
  if (!rows.length) return;
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => escape(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => escape(r[c.key])).join(",")).join("\n");
  const blob = new Blob([`${header}\n${body}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "clairvoyance";
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
