"use client";
import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import DataUpload from "./components/DataUpload/DataUpload";
import { uploadCSV, analyzeSession } from "./lib/api";
import type { TableSchema } from "./lib/api";

type UploadState = "idle" | "uploading" | "analyzing";

const LARGE_SCHEMA_THRESHOLD = 50;

export default function Home() {
  const [state, setState] = useState<UploadState>("idle");
  const [analyzingSource, setAnalyzingSource] = useState<"csv" | "db">("csv");
  const [uploadError, setUploadError] = useState<string | null>(null);

  const router = useRouter();

  const handleUpload = useCallback(async (files: File[]) => {
    setState("uploading");
    setUploadError(null);
    try {
      setState("analyzing");
      setAnalyzingSource("csv");
      const result = await uploadCSV(files);
      router.push(`/session/${result.sessionId}`);
    } catch (err: any) {
      setUploadError(err.message);
      setState("idle");
    }
  }, [router]);

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#faf6f0", color: "#2e3230", fontFamily: "var(--font-nunito-sans), sans-serif" }}>
      {/* Top nav */}
      <nav className="flex justify-between items-center w-full px-6 py-3 z-50 sticky top-0"
        style={{ backgroundColor: "rgba(250,246,240,0.95)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(196,200,188,0.3)", boxShadow: "0 1px 4px rgba(46,50,48,0.04)" }}>
        <div className="flex items-center gap-8">
          <span className="text-2xl font-bold" style={{ fontFamily: "var(--font-literata), serif", color: "#4a7c59" }}>
            Clairvoyance
          </span>
          <div className="hidden md:flex items-center gap-1 text-sm">
            <button
              onClick={() => router.push("/dashboard")}
              className="px-3 py-2 rounded-md transition-colors"
              style={{ color: "#4a4e4a" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#4a7c59"; e.currentTarget.style.backgroundColor = "#f5f1ea"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "#4a4e4a"; e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              Dashboard
            </button>
            <button className="px-3 py-2 border-b-2 font-semibold" style={{ color: "#4a7c59", borderColor: "#4a7c59" }}>
              New Analysis
            </button>
          </div>
        </div>
      </nav>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12 relative">
        {/* Soft bg glow */}
        <div className="absolute inset-0 z-0 pointer-events-none flex items-center justify-center opacity-40">
          <div className="w-[700px] h-[700px] rounded-full blur-3xl" style={{ background: "radial-gradient(circle, #f0ece4 0%, #faf6f0 70%)" }} />
        </div>

        <div className="max-w-3xl w-full z-10 flex flex-col items-center text-center">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mb-4"
            style={{ fontFamily: "var(--font-literata), serif", color: "#2e3230", letterSpacing: "-0.02em" }}>
            Ask anything about<br />your data
          </h1>
          <p className="text-lg md:text-xl mb-10 max-w-2xl leading-relaxed" style={{ color: "#4a4e4a" }}>
            Upload your datasets securely and let Clairvoyance uncover the insights hidden within.
          </p>

          {/* Upload zone */}
          <div className="w-full">
            <DataUpload
              onUpload={handleUpload}
              uploading={state === "uploading" || (state === "analyzing" && analyzingSource === "csv")}
              onConnect={async (sid, previewTables) => {
                const mapped: TableSchema[] = previewTables.map((t) => ({
                  name: t.tableName,
                  columns: t.columns,
                  rowCount: t.rowCount,
                  sample: [],
                }));
                const isLarge = mapped.length >= LARGE_SCHEMA_THRESHOLD;
                if (!isLarge) {
                  setAnalyzingSource("db");
                  setState("analyzing");
                  try { await analyzeSession(sid); } catch { /* non-fatal, session page will retry */ }
                }
                router.push(`/session/${sid}`);
              }}
            />
          </div>

          {/* Analyzing indicator */}
          {state === "analyzing" && (
            <div className="flex items-center justify-center gap-2 text-sm mt-4" style={{ color: "#4a7c59" }}>
              <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin shrink-0" style={{ borderColor: "#4a7c59", borderTopColor: "transparent" }} />
              <span>{analyzingSource === "db" ? "Analyzing your database schema…" : "Understanding your data…"}</span>
            </div>
          )}

          {/* Error */}
          {uploadError && (
            <p className="text-sm mt-4 px-4 py-2 rounded-lg" style={{ color: "#b83230", backgroundColor: "#ffdad8", border: "1px solid rgba(184,50,48,0.3)" }}>{uploadError}</p>
          )}

          {/* Example question hints */}
          {state === "idle" && (
            <div className="mt-12 w-full max-w-3xl text-left">
              <p className="text-xs font-semibold uppercase tracking-wider mb-4 px-2" style={{ color: "rgba(74,78,74,0.8)" }}>
                Then ask things like:
              </p>
              <div className="flex flex-wrap gap-3">
                {[
                  { label: "Show me revenue trends by quarter", icon: "📈" },
                  { label: "Break down user demographics", icon: "🥧" },
                  { label: "Identify anomalies in the last 30 days", icon: "⚠️" },
                  { label: "Find top performing customer segments", icon: "👥" },
                ].map(({ label, icon }) => (
                  <div
                    key={label}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm cursor-pointer transition-colors"
                    style={{ backgroundColor: "#f0ece4", border: "1px solid rgba(196,200,188,0.3)", color: "#2e3230", boxShadow: "0 1px 4px rgba(46,50,48,0.04)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#eae6de")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#f0ece4")}
                  >
                    <span>{icon}</span>
                    {label}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
