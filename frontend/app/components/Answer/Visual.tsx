"use client";
import { useMemo, useState, type ReactNode } from "react";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, ScatterChart, Scatter,
  XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import type { ColumnMeta, Row, Visual } from "../../lib/api";
import {
  SERIES_COLORS, OTHER_COLOR, detectGrain, formatDateValue, formatValue, toDate, toNumber, type DateGrain,
} from "../../lib/format";

/**
 * Renders an answer's visual. Every chart follows the same rules:
 * friendly labels, formatted numbers, at most ~15 categories / 8 series,
 * one y-axis (different units become small multiples), hairline grid,
 * and a tooltip that is never the only way to read a value (there's always the table).
 */

const GRID = "#ece6db";
const AXIS_TEXT = "#7b8279";
const MAX_CATEGORIES = 15;
const MAX_SERIES = 7; // + "Other"
const MAX_PIE_SLICES = 6;

const axisTick = { fontSize: 12, fill: AXIS_TEXT };

interface Ctx {
  rows: Row[];
  cols: ColumnMeta[];
  col: (key?: string) => ColumnMeta | undefined;
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

interface TipItem { name?: string | number; value?: unknown; color?: string; dataKey?: string | number; payload?: Row }

function ChartTooltip({
  active, payload, label, formatLabel, formatItem,
}: {
  active?: boolean;
  payload?: TipItem[];
  label?: unknown;
  formatLabel: (l: unknown, p?: Row) => string;
  formatItem: (item: TipItem) => { name: string; value: string };
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[140px] rounded-xl border border-line bg-surface px-3 py-2 text-[13px] shadow-[var(--shadow-pop)]">
      <p className="mb-1 font-semibold text-ink">{formatLabel(label, payload[0]?.payload)}</p>
      {payload.map((item, i) => {
        const { name, value } = formatItem(item);
        return (
          <div key={i} className="flex items-center justify-between gap-4 text-ink-2">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
              {name}
            </span>
            <span className="font-semibold tabular-nums text-ink">{value}</span>
          </div>
        );
      })}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  if (items.length < 2) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-ink-2">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ── Data shaping ──────────────────────────────────────────────────────────────

/** Long → wide: one row per x, one column per series value (top N by total, rest folded into "Other"). */
function pivot(rows: Row[], x: string, series: string, y: string) {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const s = String(r[series] ?? "—");
    totals.set(s, (totals.get(s) ?? 0) + Math.abs(toNumber(r[y]) ?? 0));
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const keep = new Set(ranked.slice(0, MAX_SERIES));
  const hasOther = ranked.length > MAX_SERIES;

  const byX = new Map<string, Row>();
  for (const r of rows) {
    const xv = String(r[x] ?? "");
    if (!byX.has(xv)) byX.set(xv, { [x]: r[x] });
    const out = byX.get(xv)!;
    const s = String(r[series] ?? "—");
    const key = keep.has(s) ? s : "Other";
    out[key] = ((out[key] as number) ?? 0) + (toNumber(r[y]) ?? 0);
  }
  const keys = [...ranked.slice(0, MAX_SERIES), ...(hasOther ? ["Other"] : [])];
  return { rows: [...byX.values()], keys };
}

function sortByDate(rows: Row[], x: string): Row[] {
  return [...rows].sort((a, b) => (toDate(a[x])?.getTime() ?? 0) - (toDate(b[x])?.getTime() ?? 0));
}

function seriesColor(i: number, key: string) {
  return key === "Other" ? OTHER_COLOR : SERIES_COLORS[i % SERIES_COLORS.length]!;
}

/** Measures with different units or wildly different scales must not share one axis. */
function needsSmallMultiples(rows: Row[], ys: ColumnMeta[]): boolean {
  if (ys.length < 2) return false;
  if (new Set(ys.map((c) => `${c.format}:${c.currency ?? ""}`)).size > 1) return true;
  const maxes = ys.map((c) => Math.max(...rows.map((r) => Math.abs(toNumber(r[c.key]) ?? 0)), 1e-9));
  return Math.max(...maxes) / Math.min(...maxes) > 20;
}

function NoteLine({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-xs text-ink-3">{children}</p>;
}

// ── Charts ────────────────────────────────────────────────────────────────────

function TimeOrCategoryAxisFormatter(ctx: Ctx, x: string) {
  const xc = ctx.col(x);
  const isDate = xc?.kind === "date";
  const values = ctx.rows.map((r) => r[x]);
  const grain: DateGrain | undefined = isDate ? detectGrain(values) : undefined;
  const oneYear = isDate && new Set(values.map((v) => toDate(v)?.getUTCFullYear())).size === 1;
  return {
    isDate,
    grain,
    tick: (v: unknown) => {
      if (isDate) return formatDateValue(v, grain, true, oneYear);
      const s = formatValue(v, xc);
      return s.length > 14 ? `${s.slice(0, 13)}…` : s;
    },
    full: (v: unknown) => (isDate ? formatDateValue(v, grain) : formatValue(v, xc)),
  };
}

function LineOrArea({ ctx, visual, area, height = 300 }: { ctx: Ctx; visual: Visual; area: boolean; height?: number }) {
  const x = visual.x!;
  const fmt = TimeOrCategoryAxisFormatter(ctx, x);
  const yCols = (visual.y ?? []).map((k) => ctx.col(k)).filter((c): c is ColumnMeta => !!c);

  const { rows, keys, valueCol } = useMemo(() => {
    const base = fmt.isDate ? sortByDate(ctx.rows, x) : ctx.rows;
    if (visual.series && yCols[0]) {
      const p = pivot(base, x, visual.series, yCols[0].key);
      return { rows: fmt.isDate ? sortByDate(p.rows, x) : p.rows, keys: p.keys, valueCol: yCols[0] };
    }
    return { rows: base, keys: yCols.map((c) => c.key), valueCol: yCols[0] };
  }, [ctx.rows, x, visual.series, yCols, fmt.isDate]);

  if (!visual.series && needsSmallMultiples(ctx.rows, yCols)) {
    return (
      <div className="space-y-6">
        {yCols.map((c) => (
          <div key={c.key}>
            <p className="mb-1 text-[13px] font-semibold text-ink-2">{c.label}</p>
            <LineOrArea ctx={ctx} visual={{ ...visual, y: [c.key] }} area={area} height={180} />
          </div>
        ))}
      </div>
    );
  }

  const labelFor = (k: string) => (visual.series ? k : ctx.col(k)?.label ?? k);
  const showDots = rows.length <= 24;
  const Chart = area ? AreaChart : LineChart;

  return (
    <div>
      <Legend items={keys.map((k, i) => ({ label: labelFor(k), color: seriesColor(i, k) }))} />
      <ResponsiveContainer width="100%" height={height}>
        <Chart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey={x} tick={axisTick} tickLine={false} axisLine={{ stroke: GRID }} tickFormatter={fmt.tick} minTickGap={24} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={64} niceTicks="snap125"
            tickFormatter={(v) => formatValue(v, valueCol, { compact: true })} />
          <Tooltip
            cursor={{ stroke: "#c9c1b2", strokeWidth: 1 }}
            content={(p) => (
              <ChartTooltip {...(p as object)} formatLabel={(l) => fmt.full(l)}
                formatItem={(it) => ({ name: labelFor(String(it.dataKey)), value: formatValue(it.value, visual.series ? valueCol : ctx.col(String(it.dataKey))) })} />
            )}
          />
          {keys.map((k, i) =>
            area ? (
              <Area key={k} type="monotone" dataKey={k} stroke={seriesColor(i, k)} strokeWidth={2} fill={seriesColor(i, k)}
                fillOpacity={0.1} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} isAnimationActive={false} />
            ) : (
              <Line key={k} type="monotone" dataKey={k} stroke={seriesColor(i, k)} strokeWidth={2} connectNulls
                dot={showDots ? { r: 3, strokeWidth: 2, stroke: "#fff", fill: seriesColor(i, k) } : false}
                activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }} isAnimationActive={false} />
            )
          )}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}

function Bars({ ctx, visual }: { ctx: Ctx; visual: Visual }) {
  const x = visual.x!;
  const fmt = TimeOrCategoryAxisFormatter(ctx, x);
  const yCols = (visual.y ?? []).map((k) => ctx.col(k)).filter((c): c is ColumnMeta => !!c);

  const prepared = useMemo(() => {
    let base = fmt.isDate ? sortByDate(ctx.rows, x) : ctx.rows;
    if (visual.series && yCols[0]) {
      const p = pivot(base, x, visual.series, yCols[0].key);
      return { rows: p.rows.slice(0, MAX_CATEGORIES), keys: p.keys, total: p.rows.length };
    }
    const total = base.length;
    base = base.slice(0, fmt.isDate ? 60 : MAX_CATEGORIES);
    return { rows: base, keys: yCols.map((c) => c.key), total };
  }, [ctx.rows, x, visual.series, yCols, fmt.isDate]);

  if (!visual.series && needsSmallMultiples(ctx.rows, yCols)) {
    return (
      <div className="space-y-6">
        {yCols.map((c) => (
          <div key={c.key}>
            <p className="mb-1 text-[13px] font-semibold text-ink-2">{c.label}</p>
            <Bars ctx={ctx} visual={{ ...visual, y: [c.key] }} />
          </div>
        ))}
      </div>
    );
  }

  const { rows, keys, total } = prepared;
  const valueCol = yCols[0];
  const labelFor = (k: string) => (visual.series ? k : ctx.col(k)?.label ?? k);
  const labels = rows.map((r) => fmt.full(r[x]));
  const longest = Math.max(...labels.map((l) => l.length), 0);
  const horizontal = !fmt.isDate && (longest > 10 || rows.length > 8);
  const perGroup = keys.length;
  const height = horizontal ? Math.max(180, rows.length * (perGroup * 18 + 14) + 40) : 300;
  const shown = rows.length < total ? `Showing the first ${rows.length} of ${total}. See the table for all.` : null;

  const tooltip = (
    <Tooltip
      cursor={{ fill: "rgba(31,36,33,0.04)" }}
      content={(p) => (
        <ChartTooltip {...(p as object)} formatLabel={(l) => fmt.full(l)}
          formatItem={(it) => ({ name: labelFor(String(it.dataKey)), value: formatValue(it.value, visual.series ? valueCol : ctx.col(String(it.dataKey))) })} />
      )}
    />
  );

  return (
    <div>
      <Legend items={keys.map((k, i) => ({ label: labelFor(k), color: seriesColor(i, k) }))} />
      <ResponsiveContainer width="100%" height={height}>
        {horizontal ? (
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }} barGap={2} barCategoryGap="22%">
            <CartesianGrid horizontal={false} stroke={GRID} />
            <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} niceTicks="snap125"
              tickFormatter={(v) => formatValue(v, valueCol, { compact: true })} />
            <YAxis type="category" dataKey={x} tick={axisTick} tickLine={false} axisLine={false}
              width={Math.min(180, Math.max(60, longest * 7))} tickFormatter={(v) => {
                const s = fmt.full(v);
                return s.length > 26 ? `${s.slice(0, 25)}…` : s;
              }} interval={0} />
            {tooltip}
            {keys.map((k, i) => (
              <Bar key={k} dataKey={k} fill={seriesColor(i, k)} radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false} />
            ))}
          </BarChart>
        ) : (
          <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }} barGap={2} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey={x} tick={axisTick} tickLine={false} axisLine={{ stroke: GRID }} tickFormatter={fmt.tick} interval="preserveStartEnd" minTickGap={8} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={64} niceTicks="snap125"
              tickFormatter={(v) => formatValue(v, valueCol, { compact: true })} />
            {tooltip}
            {keys.map((k, i) => (
              <Bar key={k} dataKey={k} fill={seriesColor(i, k)} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
      {shown && <NoteLine>{shown}</NoteLine>}
    </div>
  );
}

function Donut({ ctx, visual }: { ctx: Ctx; visual: Visual }) {
  const x = visual.x!, y = visual.y![0]!;
  const xc = ctx.col(x), yc = ctx.col(y);
  const slices = useMemo(() => {
    const sorted = [...ctx.rows].sort((a, b) => (toNumber(b[y]) ?? 0) - (toNumber(a[y]) ?? 0));
    const top = sorted.slice(0, MAX_PIE_SLICES).map((r) => ({ name: formatValue(r[x], xc), value: toNumber(r[y]) ?? 0 }));
    const rest = sorted.slice(MAX_PIE_SLICES).reduce((s, r) => s + (toNumber(r[y]) ?? 0), 0);
    return rest > 0 ? [...top, { name: "Other", value: rest }] : top;
  }, [ctx.rows, x, y, xc]);
  const total = slices.reduce((s, d) => s + d.value, 0) || 1;

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      <div className="h-[220px] w-[220px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="100%" paddingAngle={1}
              stroke="#fff" strokeWidth={2} isAnimationActive={false}>
              {slices.map((s, i) => <Cell key={s.name} fill={seriesColor(i, s.name)} />)}
            </Pie>
            <Tooltip content={(p) => (
              <ChartTooltip {...(p as object)} formatLabel={() => ""}
                formatItem={(it) => ({ name: String(it.name), value: `${formatValue(it.value, yc)} · ${Math.round(((toNumber(it.value) ?? 0) / total) * 100)}%` })} />
            )} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full space-y-2 text-sm">
        {slices.map((s, i) => (
          <li key={s.name} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2 text-ink-2">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: seriesColor(i, s.name) }} />
              <span className="truncate">{s.name}</span>
            </span>
            <span className="shrink-0 tabular-nums text-ink">
              <span className="font-semibold">{Math.round((s.value / total) * 100)}%</span>
              <span className="ml-2 text-ink-3">{formatValue(s.value, yc)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function integersOnly(rows: Row[], key: string): boolean {
  return rows.every((r) => Number.isInteger(r[key]));
}

function ScatterPlot({ ctx, visual }: { ctx: Ctx; visual: Visual }) {
  const x = visual.x!, y = visual.y![0]!;
  const xc = ctx.col(x), yc = ctx.col(y);
  const labelCol = ctx.cols.find((c) => c.kind === "text");

  const { points, trend } = useMemo(() => {
    const pts = ctx.rows
      .map((r) => ({ ...r, __x: toNumber(r[x]), __y: toNumber(r[y]) }))
      .filter((p) => p.__x !== null && p.__y !== null)
      .slice(0, 2000) as (Row & { __x: number; __y: number })[];
    // Least-squares trend line
    const n = pts.length;
    let tr: { __x: number; __y: number }[] = [];
    if (n >= 3) {
      const mx = pts.reduce((s, p) => s + p.__x, 0) / n;
      const my = pts.reduce((s, p) => s + p.__y, 0) / n;
      const sxx = pts.reduce((s, p) => s + (p.__x - mx) ** 2, 0);
      if (sxx > 0) {
        const slope = pts.reduce((s, p) => s + (p.__x - mx) * (p.__y - my), 0) / sxx;
        const xs = pts.map((p) => p.__x);
        const lo = Math.min(...xs), hi = Math.max(...xs);
        tr = [{ __x: lo, __y: my + slope * (lo - mx) }, { __x: hi, __y: my + slope * (hi - mx) }];
      }
    }
    return { points: pts, trend: tr };
  }, [ctx.rows, x, y]);

  // Integer measures (counts) get whole-number ticks that stay within the data's range.
  const xInt = integersOnly(points, "__x");
  const xs = points.map((p) => p.__x);
  const xSpan = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const xTicks = xInt ? Math.max(2, Math.min(6, xSpan + 1)) : 5;

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 20, left: 4 }}>
        <CartesianGrid stroke={GRID} />
        <XAxis type="number" dataKey="__x" name={xc?.label} tick={axisTick} tickLine={false} axisLine={{ stroke: GRID }}
          allowDecimals={!xInt} tickCount={xTicks} padding={{ left: 12, right: 12 }}
          tickFormatter={(v) => formatValue(v, xc, { compact: true })} domain={["dataMin", "dataMax"]}
          label={{ value: xc?.label, position: "insideBottom", offset: -12, fontSize: 12, fill: AXIS_TEXT }} />
        <YAxis type="number" dataKey="__y" name={yc?.label} tick={axisTick} tickLine={false} axisLine={false} width={64}
          allowDecimals={!integersOnly(points, "__y")}
          tickFormatter={(v) => formatValue(v, yc, { compact: true })} domain={["auto", "auto"]}
          label={{ value: yc?.label, angle: -90, position: "insideLeft", fontSize: 12, fill: AXIS_TEXT, style: { textAnchor: "middle" } }} />
        <ZAxis range={[48, 48]} />
        <Tooltip
          cursor={{ strokeDasharray: "0", stroke: "#c9c1b2" }}
          content={(p) => {
            const props = p as unknown as { active?: boolean; payload?: TipItem[] };
            const row = props.payload?.[0]?.payload;
            if (!props.active || !row) return null;
            return (
              <div className="rounded-xl border border-line bg-surface px-3 py-2 text-[13px] shadow-[var(--shadow-pop)]">
                {labelCol && <p className="mb-1 font-semibold text-ink">{formatValue(row[labelCol.key], labelCol)}</p>}
                <p className="text-ink-2">{xc?.label}: <span className="font-semibold text-ink">{formatValue(row[x], xc)}</span></p>
                <p className="text-ink-2">{yc?.label}: <span className="font-semibold text-ink">{formatValue(row[y], yc)}</span></p>
              </div>
            );
          }}
        />
        <Scatter data={points} fill={SERIES_COLORS[0]} fillOpacity={0.75} stroke="#fff" strokeWidth={1.5} isAnimationActive={false} />
        {trend.length === 2 && (
          <Scatter data={trend} line={{ stroke: "#8a8f87", strokeWidth: 1.5 }} shape={() => <g />} legendType="none" isAnimationActive={false} />
        )}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

const KPI_GRID: Record<number, string> = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" };

function Kpis({ ctx, visual }: { ctx: Ctx; visual: Visual }) {
  const row = ctx.rows[0] ?? {};
  const cols = (visual.y ?? []).map((k) => ctx.col(k)).filter((c): c is ColumnMeta => !!c);
  return (
    <div className={`grid gap-3 ${KPI_GRID[Math.min(cols.length, 4)] ?? ""}`}>
      {cols.map((c) => (
        <div key={c.key} className="rounded-xl border border-line bg-surface-2 px-5 py-4">
          <p className="text-[13px] font-medium text-ink-3">{c.label}</p>
          <p className="mt-1 text-[34px] font-semibold leading-tight tracking-tight text-ink">{formatValue(row[c.key], c, { compact: true })}</p>
          {formatValue(row[c.key], c, { compact: true }) !== formatValue(row[c.key], c) && (
            <p className="text-xs tabular-nums text-ink-3">{formatValue(row[c.key], c)}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────────

export function DataTable({ rows, cols, totalRows, truncated }: { rows: Row[]; cols: ColumnMeta[]; totalRows?: number; truncated?: boolean }) {
  const [limit, setLimit] = useState(25);
  const grains = useMemo(
    () => Object.fromEntries(cols.filter((c) => c.kind === "date").map((c) => [c.key, detectGrain(rows.map((r) => r[c.key]))])),
    [cols, rows]
  );
  if (!rows.length) return <p className="py-6 text-center text-sm text-ink-3">No matching records.</p>;
  const visible = rows.slice(0, limit);
  return (
    <div>
      <div className="max-h-[420px] overflow-auto rounded-xl border border-line">
        <table className="min-w-full border-collapse text-sm">
          <thead className="sticky top-0 z-[1] bg-surface-2">
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={`whitespace-nowrap border-b border-line px-3 py-2 text-[12px] font-semibold text-ink-2 ${c.kind === "number" ? "text-right" : "text-left"}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={i} className="odd:bg-surface even:bg-surface-2/60 hover:bg-sunken/60">
                {cols.map((c) => (
                  <td key={c.key} className={`whitespace-nowrap border-b border-line/60 px-3 py-1.5 text-ink ${c.kind === "number" ? "text-right tabular-nums" : "text-left"} max-w-[320px] truncate`}>
                    {formatValue(r[c.key], c, { grain: grains[c.key] })}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-ink-3">
        <span>
          {visible.length < rows.length ? `${visible.length} of ` : ""}
          {(totalRows ?? rows.length).toLocaleString()} {(totalRows ?? rows.length) === 1 ? "row" : "rows"}
          {truncated ? ` · showing the first ${rows.length.toLocaleString()}` : ""}
        </span>
        {visible.length < rows.length && (
          <button className="font-semibold text-brand hover:underline" onClick={() => setLimit((l) => l + 50)}>Show more</button>
        )}
      </div>
    </div>
  );
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function canChart(visual: Visual, rows: Row[]): boolean {
  if (!rows.length) return false;
  if (visual.type === "kpi") return !!visual.y?.length;
  if (["bar", "line", "area", "pie", "scatter"].includes(visual.type)) return !!visual.x && !!visual.y?.length;
  return false;
}

export default function VisualView({ visual, rows, cols }: { visual: Visual; rows: Row[]; cols: ColumnMeta[] }) {
  const ctx: Ctx = useMemo(() => {
    const byKey = new Map(cols.map((c) => [c.key, c]));
    return { rows, cols, col: (k?: string) => (k ? byKey.get(k) : undefined) };
  }, [rows, cols]);

  switch (visual.type) {
    case "kpi": return <Kpis ctx={ctx} visual={visual} />;
    case "line": return <LineOrArea ctx={ctx} visual={visual} area={false} />;
    case "area": return <LineOrArea ctx={ctx} visual={visual} area />;
    case "bar": return <Bars ctx={ctx} visual={visual} />;
    case "pie": return <Donut ctx={ctx} visual={visual} />;
    case "scatter": return <ScatterPlot ctx={ctx} visual={visual} />;
    default: return null;
  }
}
