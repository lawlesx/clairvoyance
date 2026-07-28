"use client";
import {
  BarChart as ReBarChart, Bar,
  LineChart as ReLineChart, Line,
  AreaChart as ReAreaChart, Area,
  PieChart as RePieChart, Pie, Cell,
  ScatterChart as ReScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import type { ChartConfig, ChartType } from "../../lib/api";
import { formatAxisLabel, formatTooltipValue, formatDate } from "../../lib/formatDate";

// Terra — Organic Design palette: earthy, desaturated, warm
const COLORS = [
  "#4a7c59", // forest green (primary)
  "#705c30", // warm amber (tertiary)
  "#7a5c44", // warm brown
  "#5a8a7a", // sage teal
  "#9a7a44", // golden tan
  "#4a6678", // muted slate
  "#8a6a4a", // clay
  "#6a7a54", // olive
];

const AXIS_COLOR = "#9da39a";
const GRID_COLOR = "#e8e0d4";
const TOOLTIP_STYLE = {
  backgroundColor: "#faf6f0",
  border: "1px solid #e8e0d4",
  borderRadius: "10px",
  boxShadow: "0 4px 20px rgba(46,50,48,0.06)",
  fontSize: "12px",
  color: "#2e3230",
};

interface Props {
  config: ChartConfig;
  data: Record<string, unknown>[];
  overrideType?: ChartType;
  compact?: boolean;
}

export default function ChartRenderer({ config, data, overrideType, compact }: Props) {
  if (!data.length) return null;

  const h = compact ? 200 : 300;
  const type = overrideType ?? config.type;
  const { xKey, yKey, valueKey, labelKey, title, xLabel, yLabel } = config;

  // For pie/area, derive keys from data if the config doesn't have them
  const keys = data.length ? Object.keys(data[0]!) : [];
  const resolvedXKey = xKey ?? keys[0];
  const resolvedYKey = yKey ?? keys[1] ?? keys[0];
  const resolvedLabelKey = labelKey ?? resolvedXKey;
  const resolvedValueKey = valueKey ?? resolvedYKey;

  return (
    <div className="w-full">
      {title && <p className="text-sm font-medium mb-2" style={{ color: "#4a4e4a", fontFamily: "var(--font-nunito-sans, sans-serif)" }}>{title}</p>}

      {type === "number" && (
        <div className="flex items-center justify-center p-6 rounded-xl" style={{ backgroundColor: "#f5f1ea" }}>
          <span className="text-4xl font-bold" style={{ color: "#4a7c59", fontFamily: "var(--font-literata, serif)" }}>
            {String(data[0]![resolvedValueKey ?? Object.keys(data[0]!)[0]!] ?? "—")}
          </span>
        </div>
      )}

      {type === "bar" && resolvedXKey && resolvedYKey && (
        <ResponsiveContainer width="100%" height={h}>
          <ReBarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
            <XAxis dataKey={resolvedXKey} tick={{ fontSize: 11, fill: AXIS_COLOR }} angle={-35} textAnchor="end"
              tickFormatter={(v) => formatAxisLabel(v, resolvedXKey)} axisLine={{ stroke: GRID_COLOR }} tickLine={false}
              label={xLabel ? { value: xLabel, position: "insideBottom", offset: -45, fontSize: 11, fill: AXIS_COLOR } : undefined} />
            <YAxis tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={false} tickLine={false}
              label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: AXIS_COLOR } : undefined} />
            <Tooltip contentStyle={TOOLTIP_STYLE}
              formatter={(val, name) => [val, yLabel ?? name]}
              labelFormatter={(l) => formatTooltipValue(l, resolvedXKey)}
            />
            <Bar dataKey={resolvedYKey} fill={COLORS[0]} radius={[4, 4, 0, 0]} name={yLabel ?? resolvedYKey} />
          </ReBarChart>
        </ResponsiveContainer>
      )}

      {type === "line" && resolvedXKey && resolvedYKey && (
        <ResponsiveContainer width="100%" height={h}>
          <ReLineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
            <XAxis dataKey={resolvedXKey} tick={{ fontSize: 11, fill: AXIS_COLOR }} angle={-35} textAnchor="end"
              tickFormatter={(v) => formatAxisLabel(v, resolvedXKey)} axisLine={{ stroke: GRID_COLOR }} tickLine={false}
              label={xLabel ? { value: xLabel, position: "insideBottom", offset: -45, fontSize: 11, fill: AXIS_COLOR } : undefined} />
            <YAxis tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={false} tickLine={false}
              label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: AXIS_COLOR } : undefined} />
            <Tooltip contentStyle={TOOLTIP_STYLE}
              formatter={(val, name) => [val, yLabel ?? name]}
              labelFormatter={(l) => formatTooltipValue(l, resolvedXKey)}
            />
            <Line type="monotone" dataKey={resolvedYKey} stroke={COLORS[0]} strokeWidth={2} dot={false} name={yLabel ?? resolvedYKey} />
          </ReLineChart>
        </ResponsiveContainer>
      )}

      {type === "area" && resolvedXKey && resolvedYKey && (
        <ResponsiveContainer width="100%" height={h}>
          <ReAreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 60 }}>
            <defs>
              <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS[0]} stopOpacity={0.25} />
                <stop offset="95%" stopColor={COLORS[0]} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
            <XAxis dataKey={resolvedXKey} tick={{ fontSize: 11, fill: AXIS_COLOR }} angle={-35} textAnchor="end"
              tickFormatter={(v) => formatAxisLabel(v, resolvedXKey)} axisLine={{ stroke: GRID_COLOR }} tickLine={false}
              label={xLabel ? { value: xLabel, position: "insideBottom", offset: -45, fontSize: 11, fill: AXIS_COLOR } : undefined} />
            <YAxis tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={false} tickLine={false}
              label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: AXIS_COLOR } : undefined} />
            <Tooltip contentStyle={TOOLTIP_STYLE}
              formatter={(val, name) => [val, yLabel ?? name]}
              labelFormatter={(l) => formatTooltipValue(l, resolvedXKey)}
            />
            <Area type="monotone" dataKey={resolvedYKey} stroke={COLORS[0]} strokeWidth={2} fill="url(#areaGrad)" name={yLabel ?? resolvedYKey} />
          </ReAreaChart>
        </ResponsiveContainer>
      )}

      {type === "pie" && resolvedLabelKey && resolvedValueKey && (
        <ResponsiveContainer width="100%" height={h}>
          <RePieChart>
            <Pie
              data={data}
              dataKey={resolvedValueKey}
              nameKey={resolvedLabelKey}
              cx="50%" cy="45%"
              outerRadius={compact ? 70 : 100}
              strokeWidth={2}
              stroke="#faf6f0"
            >
              {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(val, name) => [val, formatTooltipValue(name, resolvedLabelKey)]} />
            <Legend formatter={(name) => formatTooltipValue(name, resolvedLabelKey)} wrapperStyle={{ fontSize: "11px", color: AXIS_COLOR }} />
          </RePieChart>
        </ResponsiveContainer>
      )}

      {type === "scatter" && resolvedXKey && resolvedYKey && (
        <ResponsiveContainer width="100%" height={h}>
          <ReScatterChart margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
            <XAxis dataKey={resolvedXKey} name={resolvedXKey} tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={{ stroke: GRID_COLOR }} tickLine={false}
              tickFormatter={(v) => formatAxisLabel(v, resolvedXKey)} />
            <YAxis dataKey={resolvedYKey} name={resolvedYKey} tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE}
              cursor={{ strokeDasharray: "3 3", stroke: GRID_COLOR }}
              formatter={(val, name) => [val, name]}
              labelFormatter={(l) => formatTooltipValue(l, resolvedXKey)}
            />
            <Scatter data={data} fill={COLORS[0]} />
          </ReScatterChart>
        </ResponsiveContainer>
      )}

      {type === "heatmap" && (
        <div className="overflow-x-auto">
          <HeatmapTable data={data} xKey={resolvedXKey!} yKey={resolvedYKey!} valueKey={resolvedValueKey!} />
        </div>
      )}
    </div>
  );
}

function HeatmapTable({
  data, xKey, yKey, valueKey,
}: { data: Record<string, unknown>[]; xKey: string; yKey: string; valueKey: string }) {
  const xVals = [...new Set(data.map((d) => String(d[xKey])))];
  const yVals = [...new Set(data.map((d) => String(d[yKey])))];
  const lookup = new Map(data.map((d) => [`${d[xKey]}__${d[yKey]}`, Number(d[valueKey])]));
  const values = data.map((d) => Number(d[valueKey]));
  const max = Math.max(...values);

  return (
    <table className="text-xs border-collapse">
      <thead>
        <tr>
          <th className="p-1" style={{ color: AXIS_COLOR }} />
          {xVals.map((x) => <th key={x} className="p-1 font-medium" style={{ color: "#4a4e4a" }}>{formatAxisLabel(x, xKey)}</th>)}
        </tr>
      </thead>
      <tbody>
        {yVals.map((y) => (
          <tr key={y}>
            <td className="p-1 font-medium pr-3" style={{ color: "#4a4e4a" }}>{formatAxisLabel(y, yKey)}</td>
            {xVals.map((x) => {
              const val = lookup.get(`${x}__${y}`) ?? 0;
              const intensity = max ? val / max : 0;
              return (
                <td key={x} className="p-2 text-center rounded"
                  style={{
                    background: `rgba(74,124,89,${(intensity * 0.7).toFixed(2)})`,
                    color: intensity > 0.55 ? "#faf6f0" : "#2e3230",
                  }}>
                  {val}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
