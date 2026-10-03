"use client";
import { useEffect, useRef, useState } from "react";
import {
  connectDatabase, createConnection, listConnections, parseConnectionString,
  type ConnectionInput, type DataConnection,
} from "../../lib/api";
import { Button, ErrorNote, Icon, Spinner } from "../ui";

// ── File upload ───────────────────────────────────────────────────────────────

export function FileDrop({ onFiles, busy }: { onFiles: (files: File[]) => void; busy: boolean }) {
  const [drag, setDrag] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = (list: FileList | null) => {
    if (!list) return;
    const files = Array.from(list);
    const ok = files.filter((f) => /\.(csv|tsv|txt)$/i.test(f.name));
    const bad = files.filter((f) => !ok.includes(f));
    setRejected(bad.length ? `${bad.map((f) => f.name).join(", ")} ${bad.length > 1 ? "aren't" : "isn't a"} CSV. In Excel or Google Sheets use File → Save as / Download → CSV.` : null);
    if (ok.length) onFiles(ok);
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload CSV files"
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !busy && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (!busy) accept(e.dataTransfer.files); }}
        className={`flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors focus-visible:outline-2 focus-visible:outline-brand ${drag ? "border-brand bg-brand-soft" : "border-line-strong bg-surface-2 hover:border-brand/50 hover:bg-brand-soft/40"}`}
      >
        <input ref={inputRef} type="file" accept=".csv,.tsv,.txt,text/csv" multiple className="hidden"
          onChange={(e) => { accept(e.target.files); e.target.value = ""; }} />
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand">
          {busy ? <Spinner className="h-5 w-5" /> : <Icon name="upload" className="h-6 w-6" />}
        </span>
        {busy ? (
          <p className="text-[15px] font-semibold text-ink">Uploading…</p>
        ) : (
          <>
            <p className="text-[15px] font-semibold text-ink">Drop CSV files here, or <span className="text-brand underline underline-offset-2">browse</span></p>
            <p className="mt-1 text-[13px] text-ink-3">Several related files (e.g. orders + customers) can be asked about together.</p>
          </>
        )}
      </div>
      {rejected && <p className="mt-2 text-[13px] text-danger">{rejected}</p>}
    </div>
  );
}

// ── Database connection ───────────────────────────────────────────────────────

const EMPTY_FORM = { dbType: "postgresql" as "postgresql" | "mysql", host: "", port: "", dbName: "", username: "", password: "", ssl: false };

export function ConnectDatabase({ onConnected }: { onConnected: (sessionId: string) => void }) {
  const [saved, setSaved] = useState<DataConnection[]>([]);
  const [url, setUrl] = useState("");
  const [manual, setManual] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listConnections().then(setSaved).catch(() => {});
  }, []);

  const start = async (key: string, connectionId: () => Promise<string>, name?: string) => {
    setBusy(key);
    setError(null);
    try {
      const id = await connectionId();
      const { sessionId } = await connectDatabase(id, name);
      onConnected(sessionId);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const connectNew = () => {
    let input: ConnectionInput | null;
    if (manual) {
      input = {
        dbType: form.dbType, host: form.host.trim(), port: Number(form.port) || (form.dbType === "mysql" ? 3306 : 5432),
        dbName: form.dbName.trim(), username: form.username.trim(), password: form.password, sslMode: form.ssl ? "require" : undefined,
      };
      if (!input.host || !input.dbName || !input.username) {
        setError("Please fill in the server, database name and username.");
        return;
      }
    } else {
      input = parseConnectionString(url);
      if (!input) {
        setError("That doesn't look like a connection string. It should start with postgres:// or mysql:// — or enter the details instead.");
        return;
      }
    }
    const conn = input;
    start("new", async () => (await createConnection({ ...conn, name: conn.dbName })).id, conn.dbName);
  };

  const field = "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand/60 focus:ring-2 focus:ring-brand/15";

  return (
    <div className="space-y-4">
      {saved.length > 0 && (
        <div>
          <p className="mb-2 text-[13px] font-semibold text-ink-2">Your databases</p>
          <div className="flex flex-col gap-1.5">
            {saved.slice(0, 4).map((c) => (
              <button key={c.id} disabled={!!busy} onClick={() => start(c.id, async () => c.id, c.name)}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-left transition-colors hover:border-brand/40 hover:bg-brand-soft/40 disabled:opacity-60">
                <span className="flex min-w-0 items-center gap-2.5">
                  <Icon name="database" className="h-4 w-4 shrink-0 text-brand" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">{c.name}</span>
                    <span className="block truncate text-xs text-ink-3">{c.dbType === "mysql" ? "MySQL" : "PostgreSQL"} · {c.host}</span>
                  </span>
                </span>
                {busy === c.id ? <Spinner className="h-4 w-4 text-brand" /> : <Icon name="arrow" className="h-4 w-4 shrink-0 text-ink-3" />}
              </button>
            ))}
          </div>
          <p className="mb-1 mt-4 text-[13px] font-semibold text-ink-2">Or connect another</p>
        </div>
      )}

      {!manual ? (
        <div>
          <label htmlFor="conn-url" className={`mb-1.5 block text-[13px] font-semibold text-ink-2 ${saved.length ? "sr-only" : ""}`}>Connection string</label>
          <input id="conn-url" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && connectNew()}
            placeholder="postgres://user:password@host:5432/database" className={`${field} font-mono text-[13px]`} autoComplete="off" spellCheck={false} />
          <p className="mt-1.5 text-xs text-ink-3">
            Ask your engineering team for a <strong className="font-semibold text-ink-2">read-only</strong> connection string, or{" "}
            <button type="button" onClick={() => { setManual(true); setError(null); }} className="font-semibold text-brand hover:underline">enter the details instead</button>.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          <div className="col-span-2 inline-flex rounded-xl bg-sunken p-1">
            {(["postgresql", "mysql"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setForm((f) => ({ ...f, dbType: t }))}
                className={`flex-1 rounded-lg py-1.5 text-sm font-semibold ${form.dbType === t ? "bg-surface text-ink shadow-sm" : "text-ink-3"}`}>
                {t === "postgresql" ? "PostgreSQL" : "MySQL"}
              </button>
            ))}
          </div>
          <input className={`${field} col-span-2 sm:col-span-1`} placeholder="Server (host)" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
          <input className={`${field} col-span-2 sm:col-span-1`} placeholder={`Port (${form.dbType === "mysql" ? 3306 : 5432})`} inputMode="numeric" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
          <input className={`${field} col-span-2`} placeholder="Database name" value={form.dbName} onChange={(e) => setForm({ ...form, dbName: e.target.value })} />
          <input className={field} placeholder="Username" autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <input className={field} placeholder="Password" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <label className="col-span-2 flex items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={form.ssl} onChange={(e) => setForm({ ...form, ssl: e.target.checked })} className="accent-[var(--color-brand)]" />
            Require a secure (SSL) connection — needed for most cloud databases
          </label>
          <button type="button" onClick={() => { setManual(false); setError(null); }} className="col-span-2 text-left text-xs font-semibold text-brand hover:underline">
            Paste a connection string instead
          </button>
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      <Button variant="primary" className="w-full" onClick={connectNew} disabled={!!busy || (!manual && !url.trim())}>
        {busy === "new" ? <><Spinner className="h-4 w-4" /> Connecting…</> : <>Connect <Icon name="arrow" /></>}
      </Button>
      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-ink-3">
        <Icon name="lock" className="mt-px h-3.5 w-3.5 shrink-0" />
        Clairvoyance only reads — every query runs in a read-only transaction. Passwords are stored encrypted.
      </p>
    </div>
  );
}
