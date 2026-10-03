"use client";
import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Answer } from "../../lib/api";
import { columnsFor, downloadCSV, slugify } from "../../lib/format";
import VisualView, { DataTable, canChart } from "./Visual";
import { Icon } from "../ui";

interface Props {
  answer: Answer;
  question?: string;
  /** Called when the reader clicks a follow-up or clarification option. Omit for read-only views. */
  onAsk?: (q: string) => void;
}

export default function AnswerCard({ answer, question, onAsk }: Props) {
  const cols = useMemo(() => columnsFor(answer.data, answer.columns), [answer.data, answer.columns]);
  const chartable = canChart(answer.visual, answer.data);
  const hasData = answer.data.length > 0;
  const [view, setView] = useState<"chart" | "table">(chartable ? "chart" : "table");
  const [exporting, setExporting] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const corr = answer.stats?.correlation;
  const title = answer.visual.title || question || "Result";
  const showDataBlock = hasData && answer.visual.type !== "none";

  const exportPNG = async () => {
    if (!chartRef.current) return;
    setExporting(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(chartRef.current, { backgroundColor: "#ffffff", scale: 2 });
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `${slugify(title)}.png`;
      a.click();
    } finally {
      setExporting(false);
    }
  };

  return (
    <article className="animate-rise rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6">
      {/* Headline + insights */}
      {answer.legacyMarkdown ? (
        <div className="prose prose-sm max-w-none text-ink prose-headings:font-sans prose-strong:text-ink">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer.headline}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-[18px] font-semibold leading-snug text-ink sm:text-[19px]">{answer.headline}</p>
      )}

      {answer.insights.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {answer.insights.map((s, i) => (
            <li key={i} className="flex gap-2.5 text-[15px] leading-relaxed text-ink-2">
              <span className="mt-[9px] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
              <span>{s}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Clarification options */}
      {answer.clarification && answer.clarification.options.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {answer.clarification.options.map((o) => (
            <button key={o} disabled={!onAsk} onClick={() => onAsk?.(o)}
              className="rounded-full border border-brand/30 bg-brand-soft px-4 py-1.5 text-sm font-semibold text-brand-strong transition-colors hover:border-brand disabled:cursor-default">
              {o}
            </button>
          ))}
        </div>
      )}

      {/* Relationship strength */}
      {corr && (
        <div className="mt-4 flex items-start gap-3 rounded-xl bg-accent-soft px-4 py-3 text-sm text-ink-2">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <p>
            <span className="font-semibold text-ink">{corr.description.charAt(0).toUpperCase() + corr.description.slice(1)}</span>
            {` (correlation ${corr.r.toFixed(2).replace("-", "\u2212")}, across ${corr.n.toLocaleString()} data points). `}
            Values near 1 or −1 mean the two move together closely; near 0 means no clear link. A relationship doesn&apos;t by itself prove one causes the other.
          </p>
        </div>
      )}

      {/* Chart / table */}
      {showDataBlock && (
        <section className="mt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-sans text-[14px] font-semibold text-ink-2">{chartable && view === "chart" ? title : "The numbers"}</h3>
            <div className="flex items-center gap-1">
              {chartable && (
                <div className="mr-1 inline-flex rounded-lg bg-sunken p-0.5" role="tablist" aria-label="View">
                  {(["chart", "table"] as const).map((v) => (
                    <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
                      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-semibold transition-colors ${view === v ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink"}`}>
                      <Icon name={v === "chart" ? "chart" : "table"} className="h-3.5 w-3.5" />
                      {v === "chart" ? "Chart" : "Table"}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => downloadCSV(answer.data, cols, slugify(title))} title="Download as CSV (opens in Excel)"
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-semibold text-ink-3 hover:bg-sunken hover:text-ink">
                <Icon name="download" className="h-3.5 w-3.5" /> CSV
              </button>
              {chartable && view === "chart" && (
                <button onClick={exportPNG} disabled={exporting} title="Download chart as an image"
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-semibold text-ink-3 hover:bg-sunken hover:text-ink disabled:opacity-50">
                  <Icon name="download" className="h-3.5 w-3.5" /> {exporting ? "…" : "Image"}
                </button>
              )}
            </div>
          </div>

          {chartable && view === "chart" ? (
            <div ref={chartRef} className="bg-surface">
              <VisualView visual={answer.visual} rows={answer.data} cols={cols} />
            </div>
          ) : (
            <DataTable rows={answer.data} cols={cols} totalRows={answer.totalRows} truncated={answer.truncated} />
          )}
        </section>
      )}

      {/* When no visual was needed, the numbers are still one click away */}
      {hasData && answer.visual.type === "none" && (
        <details className="group mt-4">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[13px] font-semibold text-ink-3 hover:text-ink">
            <Icon name="chevron" className="h-3 w-3 transition-transform group-open:rotate-90" /> See the numbers
          </summary>
          <div className="mt-3"><DataTable rows={answer.data} cols={cols} totalRows={answer.totalRows} truncated={answer.truncated} /></div>
        </details>
      )}

      {/* How it was worked out */}
      {(answer.method || answer.sql) && (
        <details className="group mt-5 border-t border-line pt-3">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[13px] font-semibold text-ink-3 hover:text-ink">
            <Icon name="chevron" className="h-3 w-3 transition-transform group-open:rotate-90" /> How I worked this out
          </summary>
          <div className="mt-2 space-y-3 pl-4">
            {answer.method && <p className="text-sm leading-relaxed text-ink-2">{answer.method}</p>}
            {answer.sql && <SqlBlock sql={answer.sql} />}
          </div>
        </details>
      )}

      {/* Follow-ups */}
      {onAsk && answer.followUps.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {answer.followUps.map((f) => (
            <button key={f} onClick={() => onAsk(f)}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3.5 py-1.5 text-left text-[13px] text-ink-2 transition-colors hover:border-brand/40 hover:bg-brand-soft hover:text-brand-strong">
              <Icon name="arrow" className="h-3 w-3 shrink-0" />
              {f}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function SqlBlock({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <details className="group/sql">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-semibold text-ink-3 hover:text-ink">
        <Icon name="code" className="h-3.5 w-3.5" /> Show the database query (for technical readers)
      </summary>
      <div className="relative mt-2">
        <pre className="max-h-64 overflow-auto rounded-xl bg-[#232825] p-3 pr-16 font-mono text-xs leading-relaxed text-[#cfe3d3] whitespace-pre-wrap">{sql}</pre>
        <button
          onClick={() => { navigator.clipboard.writeText(sql); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="absolute right-2 top-2 rounded-md bg-white/10 px-2 py-1 text-[11px] font-semibold text-white/80 hover:bg-white/20">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </details>
  );
}
