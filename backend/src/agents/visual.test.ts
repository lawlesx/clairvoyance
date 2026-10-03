import { describe, expect, test } from "bun:test";
import {
  buildAnswer, correlationFor, mergeColumnMeta, normalizeRows, profileColumns, suggestVisual, toLabel, validateVisual,
} from "./visual";

describe("normalizeRows", () => {
  test("turns Postgres-style numeric strings into numbers", () => {
    const rows = normalizeRows([{ region: "EU", revenue: "1200.50", orders: "42" }, { region: "US", revenue: "900", orders: "7" }]);
    expect(rows[0]).toEqual({ region: "EU", revenue: 1200.5, orders: 42 });
  });

  test("keeps identifiers and leading-zero codes as strings", () => {
    const rows = normalizeRows([{ zip: "02134", customer_id: "17" }, { zip: "10001", customer_id: "18" }]);
    expect(rows[0]!.zip).toBe("02134");
    expect(rows[0]!.customer_id).toBe("17");
  });

  test("serialises dates and bigints", () => {
    const rows = normalizeRows([{ d: new Date("2024-03-01T00:00:00Z"), n: 5n }]);
    expect(rows[0]).toEqual({ d: "2024-03-01T00:00:00.000Z", n: 5 });
  });
});

describe("profileColumns", () => {
  test("detects kinds from values, not names", () => {
    const cols = profileColumns([
      { month: "2024-01", total_sales: 10, store_id: 3, day_count: 4 },
      { month: "2024-02", total_sales: 12, store_id: 4, day_count: 5 },
    ]);
    const kind = Object.fromEntries(cols.map((c) => [c.key, c.kind]));
    // "day_count" used to be treated as a date because its name contains "day".
    expect(kind).toEqual({ month: "date", total_sales: "number", store_id: "text", day_count: "number" });
  });

  test("treats integer year columns as time", () => {
    const cols = profileColumns([{ year: 2022, n: 1 }, { year: 2023, n: 2 }]);
    expect(cols[0]!.kind).toBe("date");
  });

  test("labels are readable", () => {
    expect(toLabel("total_revenue_usd")).toBe("Total revenue usd");
    expect(toLabel("avgOrderValue")).toBe("Avg Order Value");
  });
});

describe("suggestVisual", () => {
  const q = "";
  test("single row of numbers → KPI", () => {
    const rows = [{ revenue: 10, orders: 3 }];
    expect(suggestVisual(rows, profileColumns(rows), q)).toEqual({ type: "kpi", y: ["revenue", "orders"] });
  });

  test("time series → line", () => {
    const rows = [{ month: "2024-01", revenue: 1 }, { month: "2024-02", revenue: 2 }, { month: "2024-03", revenue: 3 }];
    expect(suggestVisual(rows, profileColumns(rows), q).type).toBe("line");
  });

  test("time series split by a category → multi-series line", () => {
    const rows = ["2024-01", "2024-02"].flatMap((m) => ["EU", "US"].map((r) => ({ month: m, region: r, revenue: 1 })));
    expect(suggestVisual(rows, profileColumns(rows), q)).toEqual({ type: "line", x: "month", y: ["revenue"], series: "region" });
  });

  test("two measures → scatter", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ spend: i, signups: i * 2 }));
    expect(suggestVisual(rows, profileColumns(rows), q).type).toBe("scatter");
  });

  test("category + measure → bar; share question with few parts → pie", () => {
    const rows = [{ channel: "Ads", n: 5 }, { channel: "SEO", n: 3 }, { channel: "Email", n: 2 }];
    expect(suggestVisual(rows, profileColumns(rows), "top channels").type).toBe("bar");
    expect(suggestVisual(rows, profileColumns(rows), "what share of signups comes from each channel").type).toBe("pie");
  });

  test("text-only results and un-aggregated records → table", () => {
    const names = [{ name: "a", email: "x" }, { name: "b", email: "y" }];
    expect(suggestVisual(names, profileColumns(names), q).type).toBe("table");
    const orders = Array.from({ length: 40 }, (_, i) => ({ order_date: "2024-01-01", amount: i }));
    expect(suggestVisual(orders, profileColumns(orders), q).type).toBe("table");
  });
});

describe("validateVisual", () => {
  const rows = [{ month: "2024-01", revenue: 5, region: "EU" }, { month: "2024-02", revenue: 7, region: "EU" }];
  const cols = profileColumns(rows);

  test("accepts a fitting proposal (case-insensitive keys)", () => {
    expect(validateVisual({ type: "line", x: "MONTH", y: ["Revenue"] }, rows, cols)).toEqual({
      type: "line", x: "month", y: ["revenue"], series: undefined, title: undefined,
    });
  });

  test("rejects references to columns that don't exist or aren't numeric", () => {
    expect(validateVisual({ type: "bar", x: "month", y: ["profit"] }, rows, cols)).toBeNull();
    expect(validateVisual({ type: "bar", x: "month", y: ["region"] }, rows, cols)).toBeNull();
  });

  test("rejects a pie with negative values", () => {
    const r = [{ c: "a", v: 3 }, { c: "b", v: -1 }];
    expect(validateVisual({ type: "pie", x: "c", y: ["v"] }, r, profileColumns(r))).toBeNull();
  });
});

describe("correlation", () => {
  test("computes Pearson r and describes it", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ spend: i, revenue: i * 3 + (i % 3) }));
    const c = correlationFor(rows, "spend", "revenue")!;
    expect(c.r).toBeGreaterThan(0.99);
    expect(c.description).toBe("a very strong positive relationship");
  });

  test("needs at least 5 points", () => {
    expect(correlationFor([{ a: 1, b: 2 }, { a: 2, b: 3 }, { a: 3, b: 5 }], "a", "b")).toBeUndefined();
  });
});

describe("buildAnswer", () => {
  test("falls back to a heuristic when the proposed visual doesn't fit, and merges labels", () => {
    const rows = [{ plan: "Pro", mrr: 1000 }, { plan: "Team", mrr: 400 }];
    const a = buildAnswer({
      headline: "Pro brings in the most revenue.",
      proposedVisual: { type: "scatter", x: "plan", y: ["mrr"] },
      proposedColumns: [{ key: "mrr", label: "Monthly revenue", format: "currency", currency: "usd" }, { key: "plan", label: "Plan", format: "currency" }],
      rows,
      question: "revenue by plan",
    });
    expect(a.visual).toEqual({ type: "bar", x: "plan", y: ["mrr"] });
    expect(a.columns.find((c) => c.key === "mrr")).toMatchObject({ label: "Monthly revenue", format: "currency", currency: "USD" });
    // a numeric format can't be forced onto a text column
    expect(a.columns.find((c) => c.key === "plan")!.format).toBe("text");
  });

  test("adds correlation stats for scatter plots", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ tenure_months: i, spend: 100 - i * 5 }));
    const a = buildAnswer({ headline: "x", proposedVisual: { type: "scatter", x: "tenure_months", y: ["spend"] }, rows, question: "" });
    expect(a.stats?.correlation?.r).toBe(-1);
  });

  test("merges labels case-insensitively", () => {
    const merged = mergeColumnMeta(profileColumns([{ Total: 1 }]), [{ key: "total", label: "Total orders", format: "number" }]);
    expect(merged[0]!.label).toBe("Total orders");
  });
});
