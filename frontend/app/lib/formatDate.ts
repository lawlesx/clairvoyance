/**
 * Human-readable date/time formatting utilities.
 *
 * Used in chart axis labels, tooltips, table cells, and anywhere else
 * a date or timestamp value is rendered.
 *
 * Detection heuristics (order matters):
 *   1. ISO / SQL date-time  "2024-03-15T14:30:00Z" / "2024-03-15 14:30:00"
 *   2. ISO date only        "2024-03-15"
 *   3. Year-month only      "2024-03"
 *   4. Unix timestamp (ms)  number > 1e12
 *   5. Unix timestamp (s)   number 1e9 – 1e12
 *   6. Anything else        returned as-is
 */

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MONTH_RE = /^\d{4}-\d{2}$/;

export type DateFormatStyle = "full" | "short" | "month" | "time";

const FORMAT_OPTIONS: Record<DateFormatStyle, Intl.DateTimeFormatOptions> = {
  full:  { year: "numeric", month: "short",  day: "numeric" },
  short: { month: "short",  day: "numeric" },
  month: { year: "numeric", month: "short" },
  time:  { year: "numeric", month: "short",  day: "numeric", hour: "2-digit", minute: "2-digit" },
};

function toDate(value: unknown): Date | null {
  if (value == null) return null;

  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value > 1e9 ? value * 1000 : null;
    if (ms !== null) {
      const d = new Date(ms);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  if (typeof value === "string") {
    if (YEAR_MONTH_RE.test(value)) {
      const d = new Date(`${value}-01T00:00:00`);
      return isNaN(d.getTime()) ? null : d;
    }
    if (ISO_DATE_RE.test(value) || ISO_DATETIME_RE.test(value)) {
      const normalized = ISO_DATE_RE.test(value) ? `${value}T00:00:00Z` : value;
      const d = new Date(normalized);
      return isNaN(d.getTime()) ? null : d;
    }
  }

  return null;
}

/** Detect whether a value looks like a date/timestamp. */
export function isDateLike(value: unknown): boolean {
  return toDate(value) !== null;
}

/** Detect whether a column name suggests it holds dates. */
export function isDateColumn(columnName: string): boolean {
  return /\b(date|time|at|day|month|year|period|week|created|updated|timestamp)\b/i.test(columnName);
}

/**
 * Format any date-like value into a human-readable string.
 *
 * @param value  Any value — strings, numbers, Date objects, or unknown types.
 * @param style  "full" → "Mar 15, 2024" | "short" → "Mar 15" | "month" → "Mar 2024" | "time" → "Mar 15, 2024, 02:30 PM"
 * @returns      Formatted string, or the original value stringified if not date-like.
 */
export function formatDate(value: unknown, style: DateFormatStyle = "full"): string {
  const d = toDate(value);
  if (!d) return String(value ?? "");

  if (typeof value === "string" && YEAR_MONTH_RE.test(value)) {
    return d.toLocaleDateString(undefined, FORMAT_OPTIONS.month);
  }

  return d.toLocaleDateString(undefined, FORMAT_OPTIONS[style]);
}

/**
 * Format a value for a chart axis label — short date or truncated string.
 */
export function formatAxisLabel(value: unknown, columnName?: string): string {
  const s = String(value ?? "");
  const looksDate = isDateLike(value) || (columnName ? isDateColumn(columnName) : false);

  if (looksDate && isDateLike(value)) return formatDate(value, "short");

  return s.length > 12 ? s.slice(0, 10) + "…" : s;
}

/**
 * Format a value for a chart tooltip — full date or raw value.
 */
export function formatTooltipValue(value: unknown, columnName?: string): string {
  const looksDate = isDateLike(value) || (columnName ? isDateColumn(columnName) : false);
  if (looksDate && isDateLike(value)) return formatDate(value, "full");
  return String(value ?? "");
}
