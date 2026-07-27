import type { TableSchema } from "../db/schemaReader";

export type ChartType = "bar" | "line" | "area" | "pie" | "scatter" | "heatmap" | "number";

export interface ChartConfig {
  type: ChartType;
  xKey?: string;
  yKey?: string;
  valueKey?: string;
  labelKey?: string;
  title?: string;
  xLabel?: string;
  yLabel?: string;
}

const DATE_PATTERNS = /date|time|year|month|day|week|period|quarter/i;
const NUMERIC_TYPES = /real|float|double|int|numeric|decimal|number/i;

/** Convert snake_case / camelCase column names to human-readable Title Case */
export function toLabel(col: string): string {
  return col
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bId\b/g, "ID")
    .replace(/\bUrl\b/g, "URL");
}

export function chooseVisualization(
  data: Record<string, unknown>[],
  columns: Array<{ name: string; type: string }>,
  question: string
): ChartConfig {
  if (!data.length || !columns.length) {
    return { type: "number", title: "Result" };
  }

  // Scalar: single cell
  if (data.length === 1 && columns.length === 1) {
    const col = columns[0]!;
    return {
      type: "number",
      valueKey: col.name,
      title: toLabel(col.name),
    };
  }

  const numericCols = columns.filter((c) => NUMERIC_TYPES.test(c.type));
  const dateCols = columns.filter((c) => DATE_PATTERNS.test(c.name));
  const textCols = columns.filter((c) => !NUMERIC_TYPES.test(c.type) && !DATE_PATTERNS.test(c.name));

  // Time-series: date col + numeric col → area for cumulative/trend, else line
  if (dateCols.length >= 1 && numericCols.length >= 1) {
    const dateCol = dateCols[0]!;
    const numCol = numericCols[0]!;
    const areaKeywords = /cumulative|running|total|growth|trend|over time|cumul/i;
    return {
      type: areaKeywords.test(question) ? "area" : "line",
      xKey: dateCol.name,
      yKey: numCol.name,
      xLabel: toLabel(dateCol.name),
      yLabel: toLabel(numCol.name),
      title: question,
    };
  }

  // Two numeric cols → scatter
  if (numericCols.length >= 2 && textCols.length === 0) {
    const numCol0 = numericCols[0]!;
    const numCol1 = numericCols[1]!;
    return {
      type: "scatter",
      xKey: numCol0.name,
      yKey: numCol1.name,
      xLabel: toLabel(numCol0.name),
      yLabel: toLabel(numCol1.name),
      title: question,
    };
  }

  // 2 text cols + 1 numeric → heatmap, BUT only if both categoricals are low-cardinality
  if (textCols.length >= 2 && numericCols.length === 1) {
    const textCol0 = textCols[0]!;
    const textCol1 = textCols[1]!;
    const numCol = numericCols[0]!;
    const xVals = new Set(data.map((d) => String(d[textCol0.name])));
    const yVals = new Set(data.map((d) => String(d[textCol1.name])));
    if (xVals.size <= 20 && yVals.size <= 20) {
      return {
        type: "heatmap",
        xKey: textCol0.name,
        yKey: textCol1.name,
        valueKey: numCol.name,
        xLabel: toLabel(textCol0.name),
        yLabel: toLabel(textCol1.name),
        title: question,
      };
    }
  }

  // Pie: few rows (≤8) with label + numeric — part-of-whole questions
  const pieKeywords = /breakdown|proportion|share|percentage|distribution|composition/i;
  if (
    data.length <= 8 &&
    textCols.length >= 1 &&
    numericCols.length === 1 &&
    pieKeywords.test(question)
  ) {
    return {
      type: "pie",
      labelKey: textCols[0]!.name,
      valueKey: numericCols[0]!.name,
      title: question,
    };
  }

  // Default: categorical + numeric → bar
  if (textCols.length >= 1 && numericCols.length >= 1) {
    const textCol = textCols[0]!;
    const numCol = numericCols[0]!;
    return {
      type: "bar",
      xKey: textCol.name,
      yKey: numCol.name,
      xLabel: toLabel(textCol.name),
      yLabel: toLabel(numCol.name),
      title: question,
    };
  }

  // Fallback: bar with first two columns
  const col0 = columns[0]!;
  const col1 = columns[1];
  return {
    type: "bar",
    xKey: col0.name,
    yKey: col1?.name ?? col0.name,
    xLabel: toLabel(col0.name),
    yLabel: col1 ? toLabel(col1.name) : toLabel(col0.name),
    title: question,
  };
}

/**
 * Returns an ordered array of all *relevant* chart configs for this result.
 * First element is the primary recommendation. UI renders all of them in a grid.
 * Returns at most 3 configs; never returns duplicates or irrelevant chart types.
 */
export function suggestVisualizations(
  data: Record<string, unknown>[],
  columns: Array<{ name: string; type: string }>,
  question: string
): ChartConfig[] {
  if (!data.length || !columns.length) return [];

  // Scalar: no multi-chart
  if (data.length === 1 && columns.length === 1) {
    return [chooseVisualization(data, columns, question)];
  }

  const numericCols = columns.filter((c) => NUMERIC_TYPES.test(c.type));
  const dateCols = columns.filter((c) => DATE_PATTERNS.test(c.name));
  const textCols = columns.filter((c) => !NUMERIC_TYPES.test(c.type) && !DATE_PATTERNS.test(c.name));
  const areaKeywords = /cumulative|running|total|growth|trend|over time|cumul/i;

  // Time-series: primary trend view + bar for period comparison
  if (dateCols.length >= 1 && numericCols.length >= 1) {
    const dateCol = dateCols[0]!;
    const numCol = numericCols[0]!;
    const base = {
      xKey: dateCol.name,
      yKey: numCol.name,
      xLabel: toLabel(dateCol.name),
      yLabel: toLabel(numCol.name),
      title: question,
    };
    const primaryType = areaKeywords.test(question) ? "area" : "line";
    const secondaryType: ChartType = primaryType === "area" ? "line" : "area";
    return [
      { type: primaryType, ...base },
      { type: secondaryType, ...base },
      { type: "bar", ...base },
    ];
  }

  // Two numeric cols only → scatter; bar shows magnitude per row
  if (numericCols.length >= 2 && textCols.length === 0) {
    const numCol0 = numericCols[0]!;
    const numCol1 = numericCols[1]!;
    return [{
      type: "scatter",
      xKey: numCol0.name,
      yKey: numCol1.name,
      xLabel: toLabel(numCol0.name),
      yLabel: toLabel(numCol1.name),
      title: question,
    }];
  }

  // 2 text + 1 numeric + low cardinality → heatmap primary, bar fallback
  if (textCols.length >= 2 && numericCols.length === 1) {
    const textCol0 = textCols[0]!;
    const textCol1 = textCols[1]!;
    const numCol = numericCols[0]!;
    const xVals = new Set(data.map((d) => String(d[textCol0.name])));
    const yVals = new Set(data.map((d) => String(d[textCol1.name])));
    if (xVals.size <= 20 && yVals.size <= 20) {
      return [
        { type: "heatmap", xKey: textCol0.name, yKey: textCol1.name, valueKey: numCol.name,
          xLabel: toLabel(textCol0.name), yLabel: toLabel(textCol1.name), title: question },
        { type: "bar", xKey: textCol0.name, yKey: numCol.name,
          xLabel: toLabel(textCol0.name), yLabel: toLabel(numCol.name), title: question },
      ];
    }
  }

  // Categorical + numeric
  if (textCols.length >= 1 && numericCols.length >= 1) {
    const textCol = textCols[0]!;
    const numCol = numericCols[0]!;
    const barConfig: ChartConfig = {
      type: "bar",
      xKey: textCol.name, yKey: numCol.name,
      xLabel: toLabel(textCol.name), yLabel: toLabel(numCol.name),
      title: question,
    };
    const charts: ChartConfig[] = [barConfig];

    // Add pie when ≤ 8 rows (part-of-whole is readable)
    if (data.length <= 8) {
      charts.push({
        type: "pie",
        labelKey: textCol.name, valueKey: numCol.name,
        title: question,
      });
    }
    return charts;
  }

  // Fallback — just the primary
  return [chooseVisualization(data, columns, question)];
}
