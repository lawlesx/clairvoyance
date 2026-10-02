"use client";
import { useEffect, useMemo, useState } from "react";
import { getSessionTables, type DataUnderstanding, type TableSummary } from "../../lib/api";
import { humanize } from "../../lib/format";
import { Icon, Spinner } from "../ui";

interface Props {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  sourceType: "csv" | "database";
  understanding: DataUnderstanding | null;
  understandingState: "loading" | "ready" | "error";
  onRefresh: () => void;
  onAsk: (q: string) => void;
}

const TABLE_PAGE = 60;

export default function DataPanel({ open, onClose, sessionId, sourceType, understanding, understandingState, onRefresh, onAsk }: Props) {
  const [tables, setTables] = useState<TableSummary[] | null>(null);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [limit, setLimit] = useState(TABLE_PAGE);

  useEffect(() => {
    if (!open || tables) return;
    let cancelled = false;
    getSessionTables(sessionId)
      .then((t) => { if (!cancelled) setTables(t); })
      .catch((e: Error) => { if (!cancelled) setTablesError(e.message); });
    return () => { cancelled = true; };
  }, [open, tables, sessionId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    if (!tables) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => t.name.toLowerCase().includes(q) || t.columns.some((c) => c.name.toLowerCase().includes(q)));
  }, [tables, filter]);

  if (!open) return null;

  const features = [...(understanding?.keyFeatures ?? [])].sort(
    (a, b) => ({ high: 0, medium: 1, low: 2 })[a.importance] - ({ high: 0, medium: 1, low: 2 })[b.importance]
  );

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/20" onClick={onClose}>
      <aside
        className="animate-drawer flex h-full w-full max-w-md flex-col border-l border-line bg-canvas shadow-[var(--shadow-pop)]"
        onClick={(e) => e.stopPropagation()}
        aria-label="About this data"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-2">
            <Icon name="book" className="h-5 w-5 text-brand" />
            <h2 className="text-lg font-semibold text-ink">About this data</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-3 hover:bg-sunken hover:text-ink" aria-label="Close">
            <Icon name="close" />
          </button>
        </header>

        <div className="flex-1 space-y-7 overflow-y-auto px-5 py-5">
          {/* Overview */}
          <section>
            {understanding ? (
              <>
                <span className="inline-flex rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand-strong">{understanding.domain}</span>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{understanding.summary}</p>
              </>
            ) : understandingState === "loading" ? (
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-sm text-ink-3"><Spinner className="h-3.5 w-3.5" /> Getting to know your data…</p>
                <div className="skeleton h-3.5 w-full" /><div className="skeleton h-3.5 w-3/4" />
              </div>
            ) : (
              <p className="text-sm text-ink-3">No summary yet.</p>
            )}
            <button onClick={onRefresh} disabled={understandingState === "loading"}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-ink-3 hover:text-ink disabled:opacity-50">
              <Icon name="refresh" className="h-3.5 w-3.5" /> {understanding ? "Regenerate summary" : "Try again"}
            </button>
          </section>

          {understanding?.areas && understanding.areas.length > 0 && (
            <section>
              <h3 className="mb-2 font-sans text-[13px] font-semibold uppercase tracking-wide text-ink-3">Topics covered</h3>
              <ul className="space-y-2">
                {understanding.areas.map((a) => (
                  <li key={a.name} className="rounded-xl border border-line bg-surface px-3.5 py-2.5">
                    <p className="text-sm font-semibold text-ink">{a.name}</p>
                    <p className="text-[13px] leading-snug text-ink-3">{a.description}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {features.length > 0 && (
            <section>
              <h3 className="mb-2 font-sans text-[13px] font-semibold uppercase tracking-wide text-ink-3">Things you can ask about</h3>
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
                {features.map((f) => (
                  <li key={f.column + f.label} className="px-3.5 py-2.5">
                    <p className="text-sm font-semibold text-ink">{f.label}</p>
                    <p className="text-[13px] leading-snug text-ink-3">{f.description}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {understanding && understanding.suggestedQuestions.length > 0 && (
            <section>
              <h3 className="mb-2 font-sans text-[13px] font-semibold uppercase tracking-wide text-ink-3">Questions to try</h3>
              <div className="flex flex-col gap-1.5">
                {understanding.suggestedQuestions.map((q) => (
                  <button key={q} onClick={() => { onAsk(q); onClose(); }}
                    className="rounded-lg px-3 py-2 text-left text-sm text-ink-2 hover:bg-brand-soft hover:text-brand-strong">
                    {q}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Raw structure — for people who want it */}
          <section>
            <h3 className="mb-1 font-sans text-[13px] font-semibold uppercase tracking-wide text-ink-3">
              {sourceType === "database" ? "Tables in the database" : "Files"}
              {tables && <span className="ml-1.5 font-normal normal-case tracking-normal">({tables.length.toLocaleString()})</span>}
            </h3>
            <p className="mb-3 text-xs text-ink-3">You don&apos;t need these to ask questions — they&apos;re here if you&apos;re curious.</p>

            {!tables && !tablesError && <p className="flex items-center gap-2 text-sm text-ink-3"><Spinner className="h-3.5 w-3.5" /> Loading…</p>}
            {tablesError && <p className="text-sm text-danger">{tablesError}</p>}

            {tables && tables.length > 8 && (
              <label className="mb-2 flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 focus-within:border-brand/60">
                <Icon name="search" className="h-3.5 w-3.5 text-ink-3" />
                <input value={filter} onChange={(e) => { setFilter(e.target.value); setLimit(TABLE_PAGE); }}
                  placeholder="Filter by table or field name" className="w-full bg-transparent text-sm outline-none placeholder:text-ink-3" />
              </label>
            )}

            {tables && (
              <ul className="space-y-1">
                {filtered.slice(0, limit).map((t) => (
                  <li key={t.name} className="rounded-lg border border-transparent hover:border-line">
                    <button onClick={() => setExpanded(expanded === t.name ? null : t.name)}
                      className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Icon name="chevron" className={`h-3 w-3 shrink-0 text-ink-3 transition-transform ${expanded === t.name ? "rotate-90" : ""}`} />
                        <span className="truncate text-sm text-ink">{humanize(t.name.split(".").pop()!.replace(/"/g, ""))}</span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-ink-3">~{t.rowCount.toLocaleString()} rows</span>
                    </button>
                    {expanded === t.name && (
                      <div className="flex flex-wrap gap-1 px-2.5 pb-2.5 pl-7">
                        {t.columns.map((c) => (
                          <span key={c.name} title={c.type} className="rounded-md bg-sunken px-1.5 py-0.5 text-xs text-ink-2">{humanize(c.name)}</span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {tables && filtered.length > limit && (
              <button onClick={() => setLimit((l) => l + TABLE_PAGE)} className="mt-2 text-xs font-semibold text-brand hover:underline">
                Show {Math.min(TABLE_PAGE, filtered.length - limit)} more of {filtered.length - limit}
              </button>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
