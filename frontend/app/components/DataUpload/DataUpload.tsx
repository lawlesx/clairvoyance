"use client";
import { useCallback, useRef, useState } from "react";
import { createConnection, connectDatabase, listConnections, previewConnection } from "../../lib/api";
import type { DataConnection } from "../../lib/api";

interface Props {
  onUpload: (files: File[]) => void;
  uploading: boolean;
  onConnect?: (sessionId: string, tables: PreviewTable[]) => void;
}

const DB_PRESETS = [
  { label: "Local Postgres", dbType: "postgresql" as const, host: "localhost", port: "5432", username: "postgres", dbName: "postgres" },
  { label: "Local MySQL",    dbType: "mysql"      as const, host: "localhost", port: "3306", username: "root",     dbName: "mysql" },
  { label: "Supabase",       dbType: "postgresql" as const, host: "db.<project>.supabase.co", port: "5432", username: "postgres", dbName: "postgres" },
  { label: "Neon",           dbType: "postgresql" as const, host: "ep-<id>.us-east-1.aws.neon.tech", port: "5432", username: "neondb_owner", dbName: "neondb" },
  { label: "Railway",        dbType: "postgresql" as const, host: "monorail.proxy.rlwy.net", port: "PORT", username: "postgres", dbName: "railway" },
];

type PreviewTable = { tableName: string; columns: { name: string; type: string }[]; rowCount: number };

export default function DataUpload({ onUpload, uploading, onConnect }: Props) {
  const [tab, setTab] = useState<"csv" | "db">("csv");
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [dbForm, setDbForm] = useState({
    name: "",
    dbType: "postgresql" as "postgresql" | "mysql",
    host: "",
    port: "5432",
    dbName: "",
    username: "",
    password: "",
    sslMode: "",
  });
  const [connections, setConnections] = useState<DataConnection[]>([]);
  const [dbConnecting, setDbConnecting] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [preview, setPreview] = useState<{ connId: string; tables: PreviewTable[] } | null>(null);
  const [launching, setLaunching] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      const csvFiles = Array.from(files).filter((f) => f.name.endsWith(".csv"));
      if (csvFiles.length) onUpload(csvFiles);
    },
    [onUpload]
  );

  const handleDbConnect = async () => {
    setDbError(null);
    setDbConnecting(true);
    setPreview(null);
    try {
      const conn = await createConnection({ ...dbForm, port: parseInt(dbForm.port) || 5432 });
      const { tables } = await previewConnection(conn.id);
      setPreview({ connId: conn.id, tables });
    } catch (err: any) {
      setDbError(err.message);
    } finally {
      setDbConnecting(false);
    }
  };

  const handleLaunchSession = async () => {
    if (!preview) return;
    setLaunching(true);
    setDbError(null);
    try {
      const { sessionId } = await connectDatabase(preview.connId, dbForm.name || dbForm.dbName);
      onConnect?.(sessionId, preview.tables);
    } catch (err: any) {
      setDbError(err.message);
    } finally {
      setLaunching(false);
    }
  };

  const handleLoadSaved = async () => {
    try {
      const conns = await listConnections();
      setConnections(conns);
      setShowSaved(true);
    } catch { /* non-fatal */ }
  };

  const handleUseSaved = async (conn: DataConnection) => {
    setDbConnecting(true);
    setDbError(null);
    setPreview(null);
    try {
      const { tables } = await previewConnection(conn.id);
      setPreview({ connId: conn.id, tables });
      setShowSaved(false);
    } catch (err: any) {
      setDbError(err.message);
    } finally {
      setDbConnecting(false);
    }
  };

  const applyPreset = (preset: typeof DB_PRESETS[number]) => {
    setDbForm((f) => ({ ...f, dbType: preset.dbType, host: preset.host, port: preset.port, username: preset.username, dbName: preset.dbName }));
    setPreview(null);
    setDbError(null);
  };

  // ── Shared input style ────────────────────────────────────────────────────
  const inputCls = "w-full rounded-xl px-4 py-3 text-sm outline-none transition-all";
  const inputStyle = { backgroundColor: "#faf6f0", border: "1px solid rgba(196,200,188,0.5)", color: "#2e3230" };
  const inputFocusHandlers = {
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
      e.target.style.border = "2px solid rgba(74,124,89,0.5)";
    },
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
      e.target.style.border = "1px solid rgba(196,200,188,0.5)";
    },
  };

  return (
    <div className="w-full max-w-3xl mx-auto space-y-4">
      {/* Tab switcher — segmented control */}
      <div className="flex p-1.5 rounded-xl inline-flex mx-auto" style={{ backgroundColor: "#f0ece4", border: "1px solid rgba(196,200,188,0.2)" }}>
        <button
          onClick={() => setTab("csv")}
          className="px-6 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all"
          style={tab === "csv"
            ? { backgroundColor: "#faf6f0", color: "#4a7c59", boxShadow: "0 2px 8px rgba(46,50,48,0.06)" }
            : { color: "#4a4e4a" }
          }
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 19.5m9.375-14.625v-1.5c0-.621-.504-1.125-1.125-1.125H3.75c-.621 0-1.125.504-1.125 1.125v1.5" />
          </svg>
          CSV Files
        </button>
        <button
          onClick={() => setTab("db")}
          className="px-6 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all"
          style={tab === "db"
            ? { backgroundColor: "#faf6f0", color: "#4a7c59", boxShadow: "0 2px 8px rgba(46,50,48,0.06)" }
            : { color: "#4a4e4a" }
          }
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 2.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
          </svg>
          Connect Database
        </button>
      </div>

      {tab === "csv" ? (
        /* ── CSV Dropzone ──────────────────────────────────────────────────── */
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
          onClick={() => !uploading && inputRef.current?.click()}
          className="w-full rounded-2xl p-12 flex flex-col items-center justify-center cursor-pointer transition-all duration-200 group"
          style={{
            backgroundColor: "#faf6f0",
            border: `2px dashed ${drag ? "#4a7c59" : "rgba(196,200,188,0.5)"}`,
            boxShadow: "0 4px 20px rgba(46,50,48,0.04)",
            transform: drag ? "scale(1.01)" : "scale(1)",
          }}
          onMouseEnter={(e) => { if (!drag) e.currentTarget.style.borderColor = "rgba(74,124,89,0.5)"; }}
          onMouseLeave={(e) => { if (!drag) e.currentTarget.style.borderColor = "rgba(196,200,188,0.5)"; }}
        >
          <input ref={inputRef} type="file" accept=".csv" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
          <div className="flex flex-col items-center gap-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300"
              style={{ backgroundColor: drag ? "rgba(74,124,89,0.15)" : "rgba(74,124,89,0.08)" }}
            >
              {uploading ? (
                <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "#4a7c59", borderTopColor: "transparent" }} />
              ) : (
                <svg className="w-7 h-7 transition-transform duration-300 group-hover:scale-110" style={{ color: "#4a7c59" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              )}
            </div>
            {uploading ? (
              <p className="text-sm font-medium" style={{ color: "#4a4e4a" }}>Processing your file…</p>
            ) : (
              <div className="space-y-1.5 text-center">
                <p className="text-lg font-semibold" style={{ fontFamily: "var(--font-literata), serif", color: "#2e3230" }}>
                  Drag and drop your CSV files here
                </p>
                <p className="text-sm" style={{ color: "#74796e" }}>
                  Or click to browse from your computer. We support files up to 500MB.
                </p>
                <button
                  className="mt-3 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200"
                  style={{ backgroundColor: "rgba(74,124,89,0.1)", color: "#4a7c59", border: "1px solid rgba(74,124,89,0.2)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#4a7c59"; e.currentTarget.style.color = "#ffffff"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "rgba(74,124,89,0.1)"; e.currentTarget.style.color = "#4a7c59"; }}
                >
                  Select Files
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── Database connector ────────────────────────────────────────────── */
        <div className="space-y-4">

          {/* Connection preview panel (post-connect) */}
          {preview && (
            <div
              className="rounded-2xl p-6 space-y-4"
              style={preview.tables.length === 0
                ? { backgroundColor: "rgba(248,224,168,0.2)", border: "1px solid rgba(112,92,48,0.3)" }
                : { backgroundColor: "rgba(74,124,89,0.06)", border: "1px solid rgba(74,124,89,0.3)" }
              }
            >
              {preview.tables.length === 0 ? (
                <div className="flex items-start gap-3">
                  <span className="text-base shrink-0">⚠️</span>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "#554020" }}>Database is empty</p>
                    <p className="text-xs mt-0.5" style={{ color: "#705c30" }}>No tables were found. You can still connect, but there won't be any data to explore.</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 mt-0.5 shrink-0" style={{ color: "#4a7c59" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color: "#4a7c59" }}>
                        Connected — {preview.tables.length} table{preview.tables.length !== 1 ? "s" : ""} found
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "#4a4e4a" }}>Select tables to include in your workspace</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto pr-1">
                    {preview.tables.map((t) => (
                      <span
                        key={t.tableName}
                        className="text-xs px-2.5 py-1 rounded-lg font-medium"
                        style={{ backgroundColor: "rgba(74,124,89,0.1)", color: "#2a6038", border: "1px solid rgba(74,124,89,0.2)" }}
                      >
                        {t.tableName}
                        <span className="opacity-60 ml-1">({t.columns.length})</span>
                      </span>
                    ))}
                  </div>
                </>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleLaunchSession}
                  disabled={launching}
                  className="flex-1 text-sm font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                  style={{ backgroundColor: "#4a7c59", color: "#ffffff" }}
                  onMouseEnter={(e) => { if (!launching) e.currentTarget.style.backgroundColor = "#3d6b4a"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#4a7c59"; }}
                >
                  {launching
                    ? <><div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />Starting…</>
                    : <>Start Exploring <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg></>
                  }
                </button>
                <button
                  onClick={() => setPreview(null)}
                  className="px-4 py-3 rounded-xl text-sm font-medium transition-colors"
                  style={{ border: "1px solid rgba(196,200,188,0.5)", color: "#4a4e4a", backgroundColor: "#faf6f0" }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f0ece4")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#faf6f0")}
                >
                  Back
                </button>
              </div>
            </div>
          )}

          {!preview && (
            showSaved && connections.length > 0 ? (
              /* ── Saved connections list ──────────────────────────────────── */
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold" style={{ color: "#2e3230" }}>Saved connections</h3>
                  <button
                    onClick={() => setShowSaved(false)}
                    className="text-xs font-medium transition-colors"
                    style={{ color: "#4a7c59" }}
                  >
                    + New connection
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {connections.map((conn) => (
                    <div
                      key={conn.id}
                      className="rounded-xl p-5 cursor-pointer transition-all relative overflow-hidden"
                      style={{ backgroundColor: "#faf6f0", border: "1px solid rgba(196,200,188,0.4)", boxShadow: "0 4px 20px rgba(46,50,48,0.06)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 8px 30px rgba(46,50,48,0.10)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 4px 20px rgba(46,50,48,0.06)"; }}
                    >
                      <div className="absolute top-0 right-0 w-24 h-24 rounded-bl-full" style={{ backgroundColor: "rgba(74,124,89,0.05)" }} />
                      <div className="flex items-start gap-3 mb-4">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "#f0ece4", border: "1px solid rgba(196,200,188,0.2)" }}>
                          <svg className="w-5 h-5" style={{ color: "#4a7c59" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-sm font-bold" style={{ fontFamily: "var(--font-literata), serif", color: "#2e3230" }}>{conn.name}</p>
                          <span className="text-xs px-2 py-0.5 rounded-md font-medium" style={{ backgroundColor: "rgba(74,124,89,0.1)", color: "#2a6038" }}>
                            {conn.dbType}
                          </span>
                        </div>
                      </div>
                      <div className="space-y-1.5 text-xs mb-4" style={{ color: "#4a4e4a" }}>
                        <div className="font-mono px-2 py-1 rounded" style={{ backgroundColor: "#f5f1ea" }}>{conn.host}:{conn.port}</div>
                        <div className="opacity-70">{conn.username} / {conn.dbName}</div>
                      </div>
                      <div className="flex justify-end pt-3" style={{ borderTop: "1px solid rgba(196,200,188,0.2)" }}>
                        <button
                          onClick={() => handleUseSaved(conn)}
                          disabled={dbConnecting}
                          className="flex items-center gap-1.5 text-sm font-bold transition-colors disabled:opacity-50"
                          style={{ color: "#4a7c59" }}
                        >
                          {dbConnecting ? "Connecting…" : <>Connect <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg></>}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              /* ── New connection form ─────────────────────────────────────── */
              <div
                className="rounded-2xl p-6 sm:p-8 space-y-6"
                style={{ backgroundColor: "#ffffff", border: "1px solid rgba(196,200,188,0.2)", boxShadow: "0 4px 20px rgba(46,50,48,0.06)" }}
              >
                <h3
                  className="text-lg font-semibold flex items-center gap-2 pb-4"
                  style={{ fontFamily: "var(--font-literata), serif", color: "#2e3230", borderBottom: "1px solid rgba(196,200,188,0.2)" }}
                >
                  <svg className="w-5 h-5" style={{ color: "#4a7c59" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 2.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
                  </svg>
                  Database Configuration
                </h3>

                {/* Quick-fill presets */}
                <div>
                  <label className="block text-xs font-semibold mb-2.5 uppercase tracking-wide" style={{ color: "#4a4e4a" }}>Quick Fill</label>
                  <div className="flex flex-wrap gap-2">
                    {DB_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        onClick={() => applyPreset(preset)}
                        className="px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 transition-all"
                        style={{ backgroundColor: "#faf6f0", border: "1px solid rgba(196,200,188,0.5)", color: "#2e3230" }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#4a7c59"; e.currentTarget.style.backgroundColor = "#f5f1ea"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(196,200,188,0.5)"; e.currentTarget.style.backgroundColor = "#faf6f0"; }}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  {/* Connection Name */}
                  <div className="sm:col-span-2 space-y-1.5">
                    <label className="block text-sm font-semibold" style={{ color: "#2e3230" }}>Connection Name</label>
                    <input
                      value={dbForm.name}
                      onChange={(e) => setDbForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Production Analytics DB"
                      className={inputCls}
                      style={inputStyle}
                      {...inputFocusHandlers}
                    />
                  </div>

                  {/* Database Type */}
                  <div className="space-y-1.5">
                    <label className="block text-sm font-semibold" style={{ color: "#2e3230" }}>Database Type</label>
                    <div className="relative">
                      <select
                        value={dbForm.dbType}
                        onChange={(e) => setDbForm((f) => ({ ...f, dbType: e.target.value as "postgresql" | "mysql", port: e.target.value === "mysql" ? "3306" : "5432" }))}
                        className={`${inputCls} appearance-none pr-10`}
                        style={inputStyle}
                        {...inputFocusHandlers}
                      >
                        <option value="postgresql">PostgreSQL</option>
                        <option value="mysql">MySQL</option>
                      </select>
                      <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: "#4a4e4a" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                      </svg>
                    </div>
                  </div>

                  {/* Host */}
                  <div className="space-y-1.5">
                    <label className="block text-sm font-semibold" style={{ color: "#2e3230" }}>Host</label>
                    <input
                      value={dbForm.host}
                      onChange={(e) => setDbForm((f) => ({ ...f, host: e.target.value }))}
                      placeholder="localhost or db.example.com"
                      className={inputCls}
                      style={inputStyle}
                      {...inputFocusHandlers}
                    />
                  </div>

                  {/* Port */}
                  <div className="space-y-1.5">
                    <label className="block text-sm font-semibold" style={{ color: "#2e3230" }}>Port</label>
                    <input
                      value={dbForm.port}
                      onChange={(e) => setDbForm((f) => ({ ...f, port: e.target.value }))}
                      placeholder="5432"
                      className={inputCls}
                      style={inputStyle}
                      {...inputFocusHandlers}
                    />
                  </div>

                  {/* Database Name */}
                  <div className="space-y-1.5">
                    <label className="block text-sm font-semibold" style={{ color: "#2e3230" }}>Database Name</label>
                    <input
                      value={dbForm.dbName}
                      onChange={(e) => setDbForm((f) => ({ ...f, dbName: e.target.value }))}
                      placeholder="main_db"
                      className={inputCls}
                      style={inputStyle}
                      {...inputFocusHandlers}
                    />
                  </div>

                  {/* Username */}
                  <div className="space-y-1.5">
                    <label className="block text-sm font-semibold" style={{ color: "#2e3230" }}>Username</label>
                    <input
                      value={dbForm.username}
                      onChange={(e) => setDbForm((f) => ({ ...f, username: e.target.value }))}
                      placeholder="admin_user"
                      className={inputCls}
                      style={inputStyle}
                      {...inputFocusHandlers}
                    />
                  </div>

                  {/* Password */}
                  <div className="sm:col-span-2 space-y-1.5">
                    <label className="block text-sm font-semibold" style={{ color: "#2e3230" }}>Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={dbForm.password}
                        onChange={(e) => setDbForm((f) => ({ ...f, password: e.target.value }))}
                        placeholder="••••••••"
                        className={`${inputCls} pr-12`}
                        style={inputStyle}
                        {...inputFocusHandlers}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                        style={{ color: "#74796e" }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "#4a7c59")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "#74796e")}
                      >
                        {showPassword ? (
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                        ) : (
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {dbError && (
                  <p className="text-sm px-4 py-3 rounded-xl" style={{ color: "#b83230", backgroundColor: "rgba(255,218,216,0.5)", border: "1px solid rgba(184,50,48,0.25)" }}>
                    {dbError}
                  </p>
                )}

                {/* Actions */}
                <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4" style={{ borderTop: "1px solid rgba(196,200,188,0.2)" }}>
                  <button
                    onClick={handleLoadSaved}
                    className="order-3 sm:order-1 px-5 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
                    style={{ backgroundColor: "#faf6f0", border: "1px solid rgba(196,200,188,0.5)", color: "#4a4e4a" }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f0ece4")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#faf6f0")}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" /></svg>
                    Saved
                  </button>
                  <button
                    onClick={handleDbConnect}
                    disabled={dbConnecting || !dbForm.host || !dbForm.dbName || !dbForm.username}
                    className="order-1 sm:order-2 flex-1 sm:flex-none px-6 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                    style={{ backgroundColor: "#4a7c59", color: "#ffffff" }}
                    onMouseEnter={(e) => { if (!dbConnecting) e.currentTarget.style.backgroundColor = "#3d6b4a"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#4a7c59"; }}
                  >
                    {dbConnecting
                      ? <><div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />Connecting…</>
                      : <>Connect &amp; Preview <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg></>
                    }
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

