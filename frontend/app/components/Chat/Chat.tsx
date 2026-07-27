"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { streamQuery } from "../../lib/api";
import type { ChartConfig, ChartType, AgentStep, StreamEvent } from "../../lib/api";
import ChartRenderer from "../Charts/ChartRenderer";

// ── Terra tokens ─────────────────────────────────────────────────────────────
const T = {
  bg:          "#faf6f0",
  surface:     "#f5f1ea",
  card:        "#ffffff",
  border:      "#e8e0d4",
  borderSubtle:"#eae6de",
  primary:     "#4a7c59",
  primaryDark: "#3d6b4a",
  primaryLight:"rgba(74,124,89,0.1)",
  amber:       "#705c30",
  amberLight:  "rgba(112,92,48,0.08)",
  textDark:    "#2e3230",
  textMid:     "#4a4e4a",
  textMuted:   "#74796e",
  textFaint:   "#9da39a",
  codeBg:      "#2a2e2b",
  codeText:    "#a8d5b5",
  errorBg:     "#fef2f0",
  errorText:   "#b83230",
};

// ── Export helpers ───────────────────────────────────────────────────────────
function exportToCSV(data: Record<string, unknown>[], filename = "data.csv") {
  if (!data.length) return;
  const headers = Object.keys(data[0]!);
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const csv = [headers.join(","), ...data.map((row) => headers.map((h) => escape(row[h])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportToPNG(el: HTMLElement, filename = "chart.png") {
  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(el, { backgroundColor: "#ffffff", scale: 2, useCORS: true });
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

function shouldShowChart(chart: ChartConfig, data: Record<string, unknown>[]): boolean {
  if (chart.type === "number") return false;
  if (data.length < 2) return false;
  return true;
}

const CHART_TYPE_RE = /\b(pie|bar|line|area|scatter|heatmap)\b/i;
const REFINEMENT_RE = /make\s+it|change\s+(to|it)|show\s+(as|it\s+as)|switch\s+to|use\s+a|instead|convert\s+to|as\s+a\s+(pie|bar|line|area|scatter|heatmap)|display\s+as/i;

function detectChartRefinement(text: string): ChartType | null {
  if (!REFINEMENT_RE.test(text) && !text.trim().match(/^(pie|bar|line|area|scatter|heatmap)(\s+chart|\s+graph|\s+plot)?\.?$/i)) return null;
  const m = text.match(CHART_TYPE_RE);
  if (!m) return null;
  return m[1]!.toLowerCase() as ChartType;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sql?: string;
  data?: Record<string, unknown>[];
  chart?: ChartConfig;
  charts?: ChartConfig[];
  steps?: AgentStep[];
  activeChartType?: ChartType;
  extraChartTypes?: ChartType[];
}

interface LiveStep {
  tool: string;
  description: string;
  summary?: string;
  status: "pending" | "done" | "error";
}

interface Props {
  sessionId: string;
  prefillQuestion?: string;
  onPrefillConsumed?: () => void;
  initialMessages?: import("../../lib/api").AppMessage[];
}

const TOOL_LABELS: Record<string, string> = {
  read_schema:    "Reading schema",
  generate_sql:   "Writing SQL",
  execute_query:  "Running query",
  lookup_schema:  "Looking up table",
  ask_clarification: "Clarifying",
};

const SWITCHABLE_TYPES: { type: ChartType; icon: string; label: string }[] = [
  { type: "bar",     icon: "▬", label: "Bar" },
  { type: "line",    icon: "⟋", label: "Line" },
  { type: "area",    icon: "◭", label: "Area" },
  { type: "pie",     icon: "◔", label: "Pie" },
  { type: "scatter", icon: "⊡", label: "Scatter" },
  { type: "heatmap", icon: "▦", label: "Heatmap" },
];

const SUGGESTIONS = [
  { label: "What are the top 10 rows by value?", icon: "↑" },
  { label: "Show me trends over time", icon: "⟋" },
  { label: "Summarize key statistics", icon: "Σ" },
  { label: "Find anomalies or outliers", icon: "◎" },
];

// ── ChartCard ─────────────────────────────────────────────────────────────────
function ChartCard({
  config, data, overrideType, title: labelTitle, compact = false,
}: {
  config: ChartConfig;
  data: Record<string, unknown>[];
  overrideType?: ChartType;
  title?: string;
  compact?: boolean;
}) {
  const [exporting, setExporting] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const typeInfo = SWITCHABLE_TYPES.find((s) => s.type === (overrideType ?? config.type));

  const handlePNG = useCallback(async () => {
    if (!cardRef.current) return;
    setExporting(true);
    try { await exportToPNG(cardRef.current, `${config.title ?? "chart"}.png`); }
    finally { setExporting(false); }
  }, [config.title]);

  return (
    <div ref={cardRef} className="rounded-2xl p-4 flex flex-col gap-3"
      style={{ backgroundColor: T.surface, border: `1px solid ${T.border}` }}>
      {labelTitle && (
        <p className="text-xs font-semibold flex items-center gap-1.5 uppercase tracking-wide"
          style={{ color: T.textMuted, fontFamily: "var(--font-nunito-sans), sans-serif" }}>
          <span style={{ color: T.primary }}>{typeInfo?.icon}</span>
          {labelTitle}
        </p>
      )}
      <ChartRenderer config={config} data={data} overrideType={overrideType} compact={compact} />
      <div className="flex justify-end pt-1" style={{ borderTop: `1px solid ${T.borderSubtle}` }}>
        <button
          onClick={handlePNG}
          disabled={exporting}
          className="text-xs px-3 py-1 rounded-lg transition-all disabled:opacity-40 flex items-center gap-1"
          style={{ border: `1px solid ${T.border}`, backgroundColor: T.bg, color: T.textMuted }}
          onMouseEnter={(e) => { e.currentTarget.style.color = T.primary; e.currentTarget.style.borderColor = T.primary; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = T.textMuted; e.currentTarget.style.borderColor = T.border; }}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {exporting ? "Exporting…" : "PNG"}
        </button>
      </div>
    </div>
  );
}

// ── ChartPanel ────────────────────────────────────────────────────────────────
function ChartPanel({
  chart, charts, data, msgIdx, onTypeChange, onAddView, onRemoveExtra, extraChartTypes,
}: {
  chart: ChartConfig;
  charts?: ChartConfig[];
  data: Record<string, unknown>[];
  msgIdx: number;
  onTypeChange: (idx: number, t: ChartType) => void;
  onAddView: (idx: number, t: ChartType) => void;
  onRemoveExtra: (idx: number, pos: number) => void;
  extraChartTypes: ChartType[];
}) {
  const suggestedConfigs = charts && charts.length > 1 ? charts : [chart];
  const suggestedTypes = suggestedConfigs.map((c) => c.type);
  const allTabTypes: ChartType[] = [
    ...suggestedTypes,
    ...extraChartTypes.filter((t) => !suggestedTypes.includes(t)),
  ];
  if (!allTabTypes.includes(chart.type)) allTabTypes.push(chart.type);

  const activeType = allTabTypes.includes(chart.type) ? chart.type : allTabTypes[0]!;
  const activeConfig = suggestedConfigs.find((c) => c.type === activeType) ?? { ...chart, type: activeType };

  const handleTabClick = (type: ChartType) => onTypeChange(msgIdx, type);
  const handleAddType = (type: ChartType) => {
    if (!allTabTypes.includes(type)) onAddView(msgIdx, type);
    onTypeChange(msgIdx, type);
  };
  const handleRemoveTab = (type: ChartType) => {
    const pos = extraChartTypes.indexOf(type);
    if (pos !== -1) {
      onRemoveExtra(msgIdx, pos);
      const remaining = allTabTypes.filter((t) => t !== type);
      if (remaining.length) onTypeChange(msgIdx, remaining[0]!);
    }
  };
  const handleExportCSV = useCallback(() => {
    exportToCSV(data, `${chart.title ?? "data"}.csv`);
  }, [data, chart.title]);

  const availableToAdd = SWITCHABLE_TYPES.filter((s) => !allTabTypes.includes(s.type));

  return (
    <div className="mt-4 space-y-3">
      {allTabTypes.length > 1 && (
        <div className="flex flex-wrap gap-1.5 pb-3" style={{ borderBottom: `1px solid ${T.borderSubtle}` }}>
          {allTabTypes.map((type) => {
            const t = SWITCHABLE_TYPES.find((s) => s.type === type);
            const isActive = type === activeType;
            const isExtra = extraChartTypes.includes(type);
            return (
              <div key={type} className="relative flex items-center">
                <button
                  onClick={() => handleTabClick(type)}
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-all ${isExtra ? "pr-6" : ""}`}
                  style={isActive
                    ? { backgroundColor: T.primary, borderColor: T.primary, color: "#fff", fontWeight: 600 }
                    : { backgroundColor: T.bg, borderColor: T.border, color: T.textMuted }
                  }
                >
                  <span style={{ fontFamily: "monospace" }}>{t?.icon}</span>
                  <span>{t?.label ?? type}</span>
                </button>
                {isExtra && (
                  <button
                    onClick={() => handleRemoveTab(type)}
                    className="absolute right-1.5 text-[9px] leading-none w-3.5 h-3.5 flex items-center justify-center rounded-full transition-colors"
                    style={{ color: T.textMuted }}
                    title="Remove tab"
                  >✕</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ChartCard config={activeConfig} data={data} overrideType={activeType} />

      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        {availableToAdd.length > 0 && (
          <>
            <span className="text-xs mr-0.5" style={{ color: T.textFaint, fontFamily: "var(--font-nunito-sans), sans-serif" }}>Add view:</span>
            {availableToAdd.map(({ type, icon, label }) => (
              <button
                key={type}
                onClick={() => handleAddType(type)}
                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full transition-all"
                style={{ border: `1px dashed ${T.border}`, color: T.textMuted }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = T.primary; e.currentTarget.style.color = T.primary; e.currentTarget.style.backgroundColor = T.primaryLight; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textMuted; e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                <span style={{ fontFamily: "monospace" }}>{icon}</span>
                <span>{label}</span>
              </button>
            ))}
          </>
        )}
        <button
          onClick={handleExportCSV}
          className="ml-auto text-xs px-3 py-1 rounded-full transition-all flex items-center gap-1"
          style={{ border: `1px solid ${T.border}`, backgroundColor: T.bg, color: T.textMuted }}
          onMouseEnter={(e) => { e.currentTarget.style.color = T.primary; e.currentTarget.style.borderColor = T.primary; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = T.textMuted; e.currentTarget.style.borderColor = T.border; }}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          CSV
        </button>
      </div>
    </div>
  );
}

// ── Main Chat ─────────────────────────────────────────────────────────────────
export default function Chat({ sessionId, prefillQuestion, onPrefillConsumed, initialMessages }: Props) {
  const [messages, setMessages] = useState<Message[]>(() => {
    if (!initialMessages?.length) return [];
    return initialMessages.flatMap<Message>((m) => {
      if (m.role === "user") return [{ role: "user", content: m.content.text ?? "" }];
      return [{
        role: "assistant",
        content: m.content.answer ?? "",
        sql: m.content.sql,
        data: m.content.data as Record<string, unknown>[] | undefined,
        chart: m.content.chart,
        charts: m.content.charts ?? (m.content.chart ? [m.content.chart] : undefined),
        activeChartType: m.content.chart?.type,
        extraChartTypes: [],
      }];
    });
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [liveSteps, setLiveSteps] = useState<LiveStep[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (loading) {
      setElapsed(0);
      elapsedRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } else {
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    }
    return () => { if (elapsedRef.current) clearInterval(elapsedRef.current); };
  }, [loading]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading, liveSteps]);

  useEffect(() => {
    if (prefillQuestion) { setInput(prefillQuestion); onPrefillConsumed?.(); }
  }, [prefillQuestion, onPrefillConsumed]);

  const handleTypeChange = useCallback((msgIdx: number, newType: ChartType) => {
    setMessages((prev) => prev.map((m, i) => {
      if (i !== msgIdx || !m.chart) return m;
      return { ...m, chart: { ...m.chart, type: newType }, activeChartType: newType };
    }));
  }, []);

  const handleAddView = useCallback((msgIdx: number, extraType: ChartType) => {
    setMessages((prev) => prev.map((m, i) => {
      if (i !== msgIdx) return m;
      const existing = m.extraChartTypes ?? [];
      if (existing.includes(extraType)) return m;
      return { ...m, extraChartTypes: [...existing, extraType] };
    }));
  }, []);

  const handleRemoveExtra = useCallback((msgIdx: number, pos: number) => {
    setMessages((prev) => prev.map((m, i) => {
      if (i !== msgIdx) return m;
      const updated = [...(m.extraChartTypes ?? [])];
      updated.splice(pos, 1);
      return { ...m, extraChartTypes: updated };
    }));
  }, []);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    const question = input.trim();
    if (!question || loading) return;

    const refinementType = detectChartRefinement(question);
    if (refinementType) {
      const lastAssistantIdx = [...messages].reverse().findIndex(
        (m) => m.role === "assistant" && m.data && m.data.length >= 2
      );
      if (lastAssistantIdx !== -1) {
        const realIdx = messages.length - 1 - lastAssistantIdx;
        setMessages((prev) => [
          ...prev,
          { role: "user", content: question },
          {
            role: "assistant",
            content: `Chart updated to **${refinementType}** view.`,
            data: prev[realIdx]!.data,
            chart: { ...prev[realIdx]!.chart!, type: refinementType },
            activeChartType: refinementType,
            extraChartTypes: [],
          },
        ]);
        setInput("");
        return;
      }
    }

    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setInput("");
    setLoading(true);
    setLiveSteps([]);

    let finalAnswer = "";
    let finalSql: string | undefined;
    let finalData: Record<string, unknown>[] | undefined;
    let finalChart: ChartConfig | undefined;
    let finalCharts: ChartConfig[] | undefined;
    const collectedSteps: AgentStep[] = [];
    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    try {
      await streamQuery(sessionId, question, history, (event: StreamEvent) => {
        if (event.type === "tool_start") {
          setLiveSteps((prev) => [...prev, { tool: event.tool, description: event.description, status: "pending" }]);
        } else if (event.type === "tool_done") {
          setLiveSteps((prev) => prev.map((s) =>
            s.tool === event.tool && s.status === "pending"
              ? { ...s, summary: event.summary, status: event.error ? "error" : "done" }
              : s
          ));
          collectedSteps.push({ tool: event.tool, input: {}, output: event.summary, error: event.error });
        } else if (event.type === "answer") {
          finalAnswer = event.text;
        } else if (event.type === "sql") {
          finalSql = event.sql;
        } else if (event.type === "data") {
          finalData = event.data;
          finalChart = event.chart;
          finalCharts = event.charts;
        } else if (event.type === "error") {
          finalAnswer = `Error: ${event.message}`;
        }
      });
    } catch (err: any) {
      finalAnswer = `Error: ${err.message}`;
    }

    setLiveSteps([]);
    setLoading(false);
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: finalAnswer,
        sql: finalSql,
        data: finalData,
        chart: finalChart,
        charts: finalCharts,
        activeChartType: finalChart?.type,
        extraChartTypes: [],
        steps: collectedSteps,
      },
    ]);
  }, [input, loading, messages, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col h-full relative" style={{ backgroundColor: T.bg, fontFamily: "var(--font-nunito-sans), sans-serif" }}>

      {/* ── Message list ── */}
      <div className="flex-1 overflow-y-auto px-6 py-8 space-y-8 pb-32" style={{ scrollbarWidth: "thin", scrollbarColor: "#e4e0d8 transparent" }}>

        {/* Empty state */}
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-6 pb-10">
            <div className="flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm"
                style={{ backgroundColor: T.primaryLight, border: `1px solid rgba(74,124,89,0.2)` }}>
                <svg className="w-7 h-7" style={{ color: T.primary }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-sm" style={{ color: T.textDark, fontFamily: "var(--font-literata), serif" }}>Ready to explore</p>
                <p className="text-xs mt-0.5" style={{ color: T.textMuted }}>Ask anything about your dataset</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 w-full max-w-xs">
              {SUGGESTIONS.map(({ label, icon }) => (
                <button
                  key={label}
                  onClick={() => { setInput(label); inputRef.current?.focus(); }}
                  className="flex items-start gap-2 text-left p-3 rounded-xl text-xs transition-all"
                  style={{ backgroundColor: T.surface, border: `1px solid ${T.border}`, color: T.textMid }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = T.bg; e.currentTarget.style.borderColor = T.primary; e.currentTarget.style.color = T.primary; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = T.surface; e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textMid; }}
                >
                  <span className="shrink-0 mt-0.5 font-mono text-sm leading-none" style={{ color: T.primary }}>{icon}</span>
                  <span className="leading-snug">{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.map((msg, i) => (
          <div key={i} className={`flex w-full max-w-3xl mx-auto ${msg.role === "user" ? "justify-end" : "justify-start"}`}>

            {msg.role === "user" ? (
              /* User bubble — right-aligned green */
              <div className="rounded-2xl px-6 py-4 max-w-[85%] shadow-sm"
                style={{ backgroundColor: T.primary, color: "#fff", borderTopRightRadius: "6px" }}>
                <p className="text-base leading-relaxed whitespace-pre-wrap">{msg.content}</p>
              </div>
            ) : (
              /* AI response — full-width card */
              <div className="w-full flex flex-col gap-3">
                <div className="rounded-2xl p-6 shadow-sm"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.85)",
                    backdropFilter: "blur(8px)",
                    border: "1px solid rgba(196,200,188,0.3)",
                  }}>
                  <div className="prose prose-sm max-w-none"
                    style={{ "--tw-prose-body": T.textDark, "--tw-prose-headings": T.textDark, "--tw-prose-bold": T.textDark } as React.CSSProperties}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                      code({ className, children, ...props }) {
                        const isBlock = className?.startsWith("language-");
                        return isBlock ? (
                          <code className={`${className} block rounded-xl p-3 text-xs overflow-x-auto whitespace-pre-wrap my-2`}
                            style={{ backgroundColor: T.codeBg, color: T.codeText, fontFamily: "monospace" }} {...props}>
                            {children}
                          </code>
                        ) : (
                          <code className="rounded px-1.5 py-0.5 text-xs font-mono"
                            style={{ backgroundColor: T.surface, color: T.amber }} {...props}>
                            {children}
                          </code>
                        );
                      },
                      table({ children }) {
                        return (
                          <div className="overflow-x-auto my-3 rounded-xl" style={{ border: `1px solid ${T.border}` }}>
                            <table className="min-w-full border-collapse text-xs">{children}</table>
                          </div>
                        );
                      },
                      th({ children }) {
                        return <th className="px-3 py-2 text-left text-xs font-semibold tracking-wide uppercase"
                          style={{ backgroundColor: T.surface, color: T.textMuted, borderBottom: `1px solid ${T.border}` }}>{children}</th>;
                      },
                      td({ children }) {
                        return <td className="px-3 py-2 text-xs"
                          style={{ borderBottom: `1px solid ${T.borderSubtle}`, color: T.textDark }}>{children}</td>;
                      },
                    }}>{msg.content}</ReactMarkdown>
                  </div>

                  {/* Chart */}
                  {msg.chart && msg.data && shouldShowChart(msg.chart, msg.data) && (
                    <div className="mt-4">
                      <ChartPanel
                        chart={msg.chart}
                        charts={msg.charts}
                        data={msg.data}
                        msgIdx={i}
                        onTypeChange={handleTypeChange}
                        onAddView={handleAddView}
                        onRemoveExtra={handleRemoveExtra}
                        extraChartTypes={msg.extraChartTypes ?? []}
                      />
                    </div>
                  )}
                </div>

                {/* SQL disclosure */}
                {msg.sql && (
                  <details className="group w-full">
                    <summary className="flex items-center gap-1.5 text-xs cursor-pointer select-none list-none w-fit"
                      style={{ color: T.amber }}>
                      <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                      View SQL
                    </summary>
                    <div className="mt-2 rounded-xl overflow-hidden" style={{ border: `1px solid rgba(112,92,48,0.2)` }}>
                      <div className="flex items-center justify-between px-3 py-1.5 text-xs"
                        style={{ backgroundColor: T.amberLight, borderBottom: `1px solid rgba(112,92,48,0.15)`, color: T.amber }}>
                        <span className="font-semibold tracking-wide uppercase" style={{ fontSize: "10px" }}>SQL</span>
                      </div>
                      <pre className="p-3 text-xs overflow-x-auto whitespace-pre-wrap"
                        style={{ backgroundColor: T.codeBg, color: "#c8d8a8", fontFamily: "monospace", lineHeight: 1.6 }}>
                        {msg.sql}
                      </pre>
                    </div>
                  </details>
                )}

                {/* Agent trace */}
                {msg.steps && msg.steps.length > 0 && (
                  <details className="group w-full">
                    <summary className="flex items-center gap-1.5 text-xs cursor-pointer select-none list-none w-fit"
                      style={{ color: T.textFaint }}>
                      <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                      {msg.steps.length} reasoning steps
                    </summary>
                    <div className="mt-2 space-y-1 rounded-xl p-3" style={{ backgroundColor: T.surface, border: `1px solid ${T.border}` }}>
                      {msg.steps.map((step, si) => (
                        <div key={si} className="flex items-start gap-2 text-xs">
                          <span className="mt-0.5 shrink-0 font-mono w-3 text-center"
                            style={{ color: step.error ? T.errorText : T.primary }}>
                            {step.error ? "✗" : "✓"}
                          </span>
                          <div>
                            <span className="font-semibold" style={{ color: step.error ? T.errorText : T.textDark }}>
                              {TOOL_LABELS[step.tool] ?? step.tool}
                            </span>
                            <span className="mx-1" style={{ color: T.textFaint }}>·</span>
                            <span style={{ color: step.error ? T.errorText : T.textMuted }}>{step.output}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Loading state — simple spinner + live steps */}
        {loading && (
          <div className="w-full max-w-3xl mx-auto animate-slide-in">
            <div className="flex items-center gap-3 pl-2 mb-3" style={{ color: T.textMuted, opacity: 0.85 }}>
              <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin shrink-0"
                style={{ borderColor: T.primary, borderTopColor: "transparent" }} />
              <span className="text-sm italic">
                {liveSteps.length === 0
                  ? "Thinking…"
                  : liveSteps.every((s) => s.status !== "pending")
                  ? "Composing answer…"
                  : liveSteps.find((s) => s.status === "pending")?.description ?? "Working…"}
              </span>
              <span className="text-xs tabular-nums ml-auto" style={{ color: T.textFaint }}>{elapsed}s</span>
            </div>
            {liveSteps.length > 0 && (
              <div className="space-y-1.5 pl-7">
                {liveSteps.map((step, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs animate-slide-in">
                    <span className="mt-0.5 shrink-0 w-3 text-center font-mono"
                      style={{ color: step.status === "error" ? T.errorText : step.status === "done" ? T.primary : T.textFaint }}>
                      {step.status === "pending" ? (
                        <span className="inline-block w-2.5 h-2.5 border border-t-transparent rounded-full animate-spin align-middle"
                          style={{ borderColor: T.primary, borderTopColor: "transparent" }} />
                      ) : step.status === "error" ? "✗" : "✓"}
                    </span>
                    <div>
                      <span className="font-medium"
                        style={{ color: step.status === "error" ? T.errorText : T.textDark }}>
                        {TOOL_LABELS[step.tool] ?? step.tool}
                      </span>
                      <span className="mx-1" style={{ color: T.textFaint }}>·</span>
                      <span style={{ color: step.status === "error" ? T.errorText : T.textMuted }}>
                        {step.status === "pending" ? step.description : (step.summary ?? "")}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input bar — pill style ── */}
      <div className="absolute bottom-0 left-0 w-full pt-10 pb-6 px-6"
        style={{ background: `linear-gradient(to top, ${T.bg} 70%, transparent)` }}>
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
          <div className="flex items-center gap-2 rounded-full px-4 py-2 transition-all"
            style={{ backgroundColor: T.card, border: `1px solid ${T.border}`, boxShadow: "0 1px 6px rgba(46,50,48,0.06)" }}
            onFocusCapture={(e) => (e.currentTarget.style.borderColor = T.primary)}
            onBlurCapture={(e) => (e.currentTarget.style.borderColor = T.border)}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 100) + "px";
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question, or try: make it a pie chart…"
              disabled={loading}
              className="flex-1 text-sm bg-transparent outline-none disabled:opacity-50 resize-none leading-relaxed"
              style={{ color: T.textDark, minHeight: "28px", maxHeight: "100px", overflowY: "auto", fontFamily: "var(--font-nunito-sans), sans-serif" }}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="shrink-0 rounded-full px-5 py-2 flex items-center gap-2 text-sm font-semibold transition-all disabled:opacity-40"
              style={{ backgroundColor: input.trim() && !loading ? T.primary : T.surface, color: input.trim() && !loading ? "#fff" : T.textMuted }}
            >
              {loading ? (
                <div className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin"
                  style={{ borderColor: "currentColor", borderTopColor: "transparent" }} />
              ) : (
                <>
                  Ask
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
