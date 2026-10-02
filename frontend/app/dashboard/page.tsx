"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppHeader from "../components/AppHeader";
import { Button, ErrorNote, Icon, Modal, Spinner } from "../components/ui";
import { deleteSession, listSessions, revokeShare, searchSessions, shareSession, type AppSession } from "../lib/api";
import { timeAgo } from "../lib/format";

export default function DashboardPage() {
  const router = useRouter();
  const [all, setAll] = useState<AppSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [semantic, setSemantic] = useState<AppSession[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [share, setShare] = useState<{ id: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AppSession | null>(null);

  useEffect(() => {
    listSessions().then(setAll).catch((e: Error) => setError(e.message));
  }, []);

  // Instant name/summary filter, plus semantic search over past questions (when enabled).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onQuery = (q: string) => {
    setQuery(q);
    setSemantic(null);
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 3) return;
    timer.current = setTimeout(async () => {
      setSearching(true);
      try { setSemantic(await searchSessions(q)); } catch { /* keyword filter still applies */ }
      setSearching(false);
    }, 400);
  };

  const sessions = useMemo(() => {
    if (!all) return [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    const local = all.filter((s) => [s.name, s.domain, s.summary].some((t) => t?.toLowerCase().includes(q)));
    const ids = new Set(local.map((s) => s.id));
    return [...local, ...(semantic ?? []).filter((s) => !ids.has(s.id))];
  }, [all, query, semantic]);

  const openShare = useCallback(async (s: AppSession) => {
    const { shareToken } = await shareSession(s.id);
    setAll((prev) => prev?.map((x) => (x.id === s.id ? { ...x, shareToken } : x)) ?? prev);
    setShare({ id: s.id, url: `${window.location.origin}/share/${shareToken}` });
  }, []);

  const doDelete = async () => {
    if (!confirmDelete) return;
    await deleteSession(confirmDelete.id);
    setAll((prev) => prev?.filter((s) => s.id !== confirmDelete.id) ?? prev);
    setConfirmDelete(null);
  };

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-6">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-[30px] font-semibold tracking-tight text-ink">My analyses</h1>
            <p className="mt-1 text-[15px] text-ink-2">Pick up where you left off, or start something new.</p>
          </div>
          <div className="flex gap-2">
            <label className="flex h-10 w-full items-center gap-2 rounded-xl border border-line bg-surface px-3 focus-within:border-brand/60 sm:w-72">
              {searching ? <Spinner className="h-3.5 w-3.5 text-ink-3" /> : <Icon name="search" className="h-4 w-4 text-ink-3" />}
              <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search analyses and past questions"
                className="w-full bg-transparent text-sm outline-none placeholder:text-ink-3" />
            </label>
            <Button variant="primary" onClick={() => router.push("/")} className="shrink-0"><Icon name="plus" /> New</Button>
          </div>
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}
        {!all && !error && <div className="flex justify-center py-24 text-brand"><Spinner className="h-6 w-6" /></div>}

        {all && all.length === 0 && (
          <div className="mx-auto max-w-md rounded-2xl border border-dashed border-line-strong bg-surface-2 px-8 py-14 text-center">
            <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand"><Icon name="sparkle" className="h-6 w-6" /></span>
            <p className="text-lg font-semibold text-ink">No analyses yet</p>
            <p className="mt-1 text-sm text-ink-2">Upload a spreadsheet or connect a database to ask your first question.</p>
            <Button variant="primary" className="mt-5" onClick={() => router.push("/")}>Get started</Button>
          </div>
        )}

        {all && all.length > 0 && sessions.length === 0 && (
          <p className="py-16 text-center text-sm text-ink-3">Nothing matches “{query}”.</p>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sessions.map((s) => (
            <SessionCard key={s.id} s={s} onShare={() => openShare(s)} onDelete={() => setConfirmDelete(s)} />
          ))}
        </div>
      </main>

      <Modal open={!!share} onClose={() => setShare(null)} title="Share this analysis">
        <p className="mb-4 text-sm text-ink-2">Anyone with the link can read the questions and answers.</p>
        <div className="flex gap-2">
          <input readOnly value={share?.url ?? ""} onFocus={(e) => e.target.select()}
            className="min-w-0 flex-1 rounded-xl border border-line bg-sunken px-3 py-2 text-sm text-ink outline-none" />
          <Button variant="primary" onClick={() => { navigator.clipboard.writeText(share?.url ?? ""); setCopied(true); setTimeout(() => setCopied(false), 1800); }}>
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
        <div className="mt-5 flex justify-between">
          <Button variant="danger" size="sm" onClick={async () => {
            if (!share) return;
            await revokeShare(share.id);
            setAll((prev) => prev?.map((x) => (x.id === share.id ? { ...x, shareToken: null } : x)) ?? prev);
            setShare(null);
          }}>Turn off link</Button>
          <Button variant="ghost" size="sm" onClick={() => setShare(null)}>Done</Button>
        </div>
      </Modal>

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete this analysis?">
        <p className="text-sm text-ink-2">
          “{confirmDelete?.name}” and its conversation will be deleted. {confirmDelete?.sourceType === "csv" ? "The uploaded file is removed too." : "Your database itself is not affected."}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="primary" className="!bg-danger hover:!bg-danger/90" onClick={doDelete}>Delete</Button>
        </div>
      </Modal>
    </div>
  );
}

function SessionCard({ s, onShare, onDelete }: { s: AppSession; onShare: () => void; onDelete: () => void }) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  return (
    <div className="group relative flex flex-col rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)] transition-colors hover:border-line-strong">
      <Link href={`/session/${s.id}`} className="absolute inset-0 rounded-2xl" aria-label={`Open ${s.name}`} />
      <div className="flex items-start justify-between gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${s.sourceType === "database" ? "bg-brand-soft text-brand" : "bg-accent-soft text-accent"}`}>
          <Icon name={s.sourceType === "database" ? "database" : "file"} className="h-[18px] w-[18px]" />
        </span>
        <div className="relative z-10" ref={ref}>
          <button onClick={() => setMenu((m) => !m)} aria-label="More actions"
            className="rounded-lg p-1.5 text-ink-3 opacity-70 hover:bg-sunken hover:text-ink group-hover:opacity-100">
            <Icon name="dots" className="h-5 w-5" />
          </button>
          {menu && (
            <div className="absolute right-0 top-9 w-40 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-[var(--shadow-pop)]">
              <button onClick={() => { setMenu(false); onShare(); }} className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm text-ink hover:bg-sunken">
                <Icon name="share" /> Share
              </button>
              <button onClick={() => { setMenu(false); onDelete(); }} className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm text-danger hover:bg-danger-soft">
                <Icon name="trash" /> Delete
              </button>
            </div>
          )}
        </div>
      </div>
      <h2 className="mt-3 truncate font-sans text-[16px] font-semibold text-ink">{s.name}</h2>
      {s.domain && <p className="mt-0.5 text-[13px] font-semibold text-brand">{s.domain}</p>}
      <p className="mt-2 line-clamp-2 min-h-[40px] text-[13px] leading-relaxed text-ink-3">
        {s.summary ?? (s.sourceType === "database" ? "Live database connection" : "Uploaded spreadsheet")}
      </p>
      <div className="mt-4 flex items-center justify-between text-xs text-ink-3">
        <span>{s.questionCount ? `${s.questionCount} question${s.questionCount === 1 ? "" : "s"}` : "No questions yet"} · {timeAgo(s.updatedAt)}</span>
        {s.shareToken && <span className="rounded-full bg-brand-soft px-2 py-0.5 font-semibold text-brand-strong">Shared</span>}
      </div>
    </div>
  );
}
