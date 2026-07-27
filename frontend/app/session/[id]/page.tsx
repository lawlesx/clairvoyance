"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { Panel, Group, Separator, usePanelRef } from "react-resizable-panels";
import Chat from "../../components/Chat/Chat";
import SchemaViewer from "../../components/SchemaViewer/SchemaViewer";
import DataInsights from "../../components/DataInsights/DataInsights";
import { getSession, updateSession, shareSession, revokeShare, analyzeSession } from "../../lib/api";
import type { TableSchema, DataUnderstanding, AppMessage } from "../../lib/api";

const LARGE_SCHEMA_THRESHOLD = 50;

export default function SessionPage() {
  const params = useParams();
  const sessionId = params.id as string;
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [sessionName, setSessionName] = useState<string>("Untitled Session");
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [resumedMessages, setResumedMessages] = useState<AppMessage[] | undefined>();
  const [tables, setTables] = useState<TableSchema[]>([]);
  const [understanding, setUnderstanding] = useState<DataUnderstanding | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [prefillQuestion, setPrefillQuestion] = useState<string | undefined>();
  const [sidebarTab, setSidebarTab] = useState<"context" | "schema">("context");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const isLargeSchema = tables.length >= LARGE_SCHEMA_THRESHOLD;
  const titleInputRef = useRef<HTMLInputElement>(null);
  const leftPanelRef = usePanelRef();
  const rightPanelRef = usePanelRef();

  const loadInsights = useCallback(async (sid: string) => {
    setInsightLoading(true);
    setInsightError(null);
    try {
      const u = await analyzeSession(sid);
      setUnderstanding(u);
      setFromCache(false);
    } catch (err: any) {
      console.error("[Insights] analyzeSession failed:", err);
      setInsightError(err.message ?? "Failed to load insights");
    } finally {
      setInsightLoading(false);
    }
  }, []);

  // Load session on mount
  useEffect(() => {
    getSession(sessionId)
      .then(({ session, messages, understanding: u, tables: t }) => {
        setSessionName(session.name);
        setShareToken(session.shareToken);
        setResumedMessages(messages);
        if (u) { setUnderstanding(u); setFromCache(true); }
        if (t?.length) setTables(t);
        setLoading(false);
        // Trigger background insight load if missing (skip for large schemas)
        if (!u && (!t || t.length < LARGE_SCHEMA_THRESHOLD)) loadInsights(sessionId);
      })
      .catch(() => {
        router.replace("/");
      });
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTitleBlur = useCallback(async () => {
    if (!sessionName.trim()) return;
    try {
      await updateSession(sessionId, { name: sessionName.trim() });
    } catch { /* non-fatal */ }
  }, [sessionId, sessionName]);

  const handleShareOpen = useCallback(async () => {
    if (!shareToken) {
      const { shareToken: token } = await shareSession(sessionId);
      setShareToken(token);
    }
    setShowShareModal(true);
  }, [sessionId, shareToken]);

  const handleRevokeShare = useCallback(async () => {
    await revokeShare(sessionId);
    setShareToken(null);
    setShowShareModal(false);
  }, [sessionId]);

  const handleCopyShare = useCallback(() => {
    if (!shareToken) return;
    navigator.clipboard.writeText(`${window.location.origin}/share/${shareToken}`);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  }, [shareToken]);

  const handleQuestionClick = useCallback((q: string) => {
    setPrefillQuestion(q);
  }, []);

  const toggleLeft = useCallback(() => {
    const p = leftPanelRef.current;
    if (!p) return;
    if (p.isCollapsed()) { p.expand(); } else { p.collapse(); }
  }, [leftPanelRef]);

  const toggleRight = useCallback(() => {
    const p = rightPanelRef.current;
    if (!p) return;
    if (p.isCollapsed()) { p.expand(); } else { p.collapse(); }
  }, [rightPanelRef]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ backgroundColor: "#faf6f0" }}>
        <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "#4a7c59", borderTopColor: "transparent" }} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ backgroundColor: "#f5f1ea" }}>

      {/* ── TOP BAR ── */}
      <div className="flex items-center justify-between px-5 shrink-0" style={{ height: "48px", borderBottom: "1px solid #e8e0d4", backgroundColor: "#faf6f0" }}>
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => router.push("/dashboard")}
            className="transition-colors"
            style={{ color: "#74796e" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#4a7c59")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#74796e")}
          >
            Dashboard
          </button>
          <svg className="w-3 h-3 shrink-0" style={{ color: "#c4c8bc" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
          <input
            ref={titleInputRef}
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => { if (e.key === "Enter") titleInputRef.current?.blur(); }}
            className="font-medium bg-transparent border-none outline-none min-w-0"
            style={{ color: "#2e3230", maxWidth: "240px" }}
            placeholder="Session name…"
          />
        </div>
        <div className="flex items-center gap-3">
          {understanding && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold" style={{ backgroundColor: "#EAF0E7", color: "#4A6741", border: "1px solid #D0DEC9" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              {understanding.domain}
            </span>
          )}
          <button
            onClick={() => router.push("/")}
            title="New analysis"
            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
            style={{ backgroundColor: "#1e4d2b", color: "#ffffff" }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#163a20")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#1e4d2b")}
          >
            + New
          </button>
          <button
            onClick={handleShareOpen}
            title="Share session"
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: "#74796e" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#4a7c59")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#74796e")}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <Group orientation="horizontal" className="h-full w-full">

          {/* ── LEFT PANEL: Dataset Context ── */}
          <Panel
            panelRef={leftPanelRef}
            defaultSize={20}
            minSize={12}
            collapsible
            onResize={(size) => setLeftCollapsed(size.asPercentage < 2)}
            style={{ backgroundColor: "#ffffff", borderRight: "1px solid rgba(196,200,188,0.4)" }}
            className="flex flex-col min-w-0"
          >
            <div className="flex flex-col h-full">
              <div className="shrink-0" style={{ borderBottom: "1px solid rgba(196,200,188,0.3)" }}>
                <div className="flex items-center justify-between px-5 pt-4 pb-2">
                  <h2 style={{ fontFamily: "var(--font-literata), serif", fontWeight: 700, fontSize: "16px", color: "#2e3230", lineHeight: 1.2 }}>
                    Dataset Context
                  </h2>
                  <button
                    onClick={toggleLeft}
                    title="Collapse sidebar"
                    className="p-1 rounded-lg transition-colors"
                    style={{ color: "#c4c8bc" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#74796e")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#c4c8bc")}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7M18 19l-7-7 7-7" />
                    </svg>
                  </button>
                </div>
                <div className="flex px-5 pb-0 gap-1">
                  {!isLargeSchema && (
                    <button
                      onClick={() => setSidebarTab("context")}
                      className="text-xs px-3 py-1.5 font-medium transition-colors"
                      style={sidebarTab === "context"
                        ? { color: "#4a7c59", borderBottom: "2px solid #4a7c59" }
                        : { color: "#9da39a", borderBottom: "2px solid transparent" }
                      }
                    >
                      Context
                    </button>
                  )}
                  <button
                    onClick={() => setSidebarTab("schema")}
                    className="text-xs px-3 py-1.5 font-medium transition-colors"
                    style={sidebarTab === "schema"
                      ? { color: "#4a7c59", borderBottom: "2px solid #4a7c59" }
                      : { color: "#9da39a", borderBottom: "2px solid transparent" }
                    }
                  >
                    Schema
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-5" style={{ scrollbarWidth: "thin", scrollbarColor: "#e4e0d8 transparent" }}>
                {sidebarTab === "context" && (
                  <>
                    {isLargeSchema && (
                      <p className="text-sm leading-relaxed" style={{ color: "#4a4e4a" }}>
                        This database has <strong style={{ color: "#2e3230" }}>{tables.length} tables</strong>. AI context is skipped for schemas with {LARGE_SCHEMA_THRESHOLD}+ tables.
                      </p>
                    )}
                    {!isLargeSchema && understanding && (
                      <DataInsights
                        understanding={understanding}
                        fromCache={fromCache}
                        onQuestionClick={handleQuestionClick}
                        hideQuestions
                      />
                    )}
                    {!isLargeSchema && !understanding && (
                      <div className="flex flex-col items-center justify-center min-h-[160px] gap-3 text-center">
                        {insightLoading ? (
                          <>
                            <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "#4a7c59", borderTopColor: "transparent" }} />
                            <p className="text-xs italic" style={{ color: "#74796e" }}>Analyzing schema…</p>
                          </>
                        ) : insightError ? (
                          <>
                            <p className="text-xs" style={{ color: "#b83230" }}>{insightError}</p>
                            <button
                              onClick={() => loadInsights(sessionId)}
                              className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                              style={{ backgroundColor: "#f5f1ea", color: "#4a7c59" }}
                            >
                              Retry
                            </button>
                          </>
                        ) : (
                          <>
                            <p className="text-xs" style={{ color: "#74796e" }}>No context yet.</p>
                            <button
                              onClick={() => loadInsights(sessionId)}
                              className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                              style={{ backgroundColor: "#f5f1ea", color: "#4a7c59" }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#eae6de")}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#f5f1ea")}
                            >
                              Load context
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
                {sidebarTab === "schema" && <SchemaViewer tables={tables} />}
              </div>

              <div className="px-5 py-3 shrink-0" style={{ borderTop: "1px solid rgba(196,200,188,0.3)" }}>
                <button
                  onClick={() => router.push("/")}
                  className="w-full text-xs py-1 transition-colors"
                  style={{ color: "#74796e" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#4a7c59")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "#74796e")}
                >
                  ← New analysis
                </button>
              </div>
            </div>
          </Panel>

          <ResizeHandle />

          {/* ── CENTER PANEL: Chat ── */}
          <Panel defaultSize={55} minSize={30} className="flex flex-col min-w-0 relative">
            {leftCollapsed && (
              <button
                onClick={toggleLeft}
                title="Expand sidebar"
                className="absolute top-3 left-3 z-10 rounded-lg p-1.5 shadow-sm transition-colors"
                style={{ backgroundColor: "#faf6f0", border: "1px solid #e8e0d4", color: "#74796e" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#4a7c59")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#74796e")}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M6 5l7 7-7 7" />
                </svg>
              </button>
            )}
            <Chat
              sessionId={sessionId}
              prefillQuestion={prefillQuestion}
              onPrefillConsumed={() => setPrefillQuestion(undefined)}
              initialMessages={resumedMessages}
            />
          </Panel>

          <ResizeHandle />

          {/* ── RIGHT PANEL: Ideas — hidden for large schemas ── */}
          {!isLargeSchema && (
            <Panel
              panelRef={rightPanelRef}
              defaultSize={25}
              minSize={14}
              collapsible
              onResize={(size) => setRightCollapsed(size.asPercentage < 2)}
              style={{ backgroundColor: "#faf6f0", borderLeft: "1px solid #e8e0d4" }}
              className="flex flex-col min-w-0"
            >
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between px-4 shrink-0" style={{ borderBottom: "1px solid #e8e0d4", height: "40px" }}>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#74796e" }}>Ideas</span>
                  <button
                    onClick={toggleRight}
                    title="Collapse panel"
                    className="p-1 rounded transition-colors"
                    style={{ color: "#c4c8bc" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#74796e")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#c4c8bc")}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M6 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {insightLoading && (
                    <div className="flex flex-col items-center gap-3 px-3 py-8 text-center">
                      <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "#4a7c59", borderTopColor: "transparent" }} />
                      <p className="text-xs" style={{ color: "#74796e" }}>Analyzing your data…</p>
                    </div>
                  )}
                  {!insightLoading && insightError && (
                    <div className="flex flex-col items-center gap-3 px-3 py-8 text-center">
                      <p className="text-xs" style={{ color: "#C0392B" }}>{insightError}</p>
                      <button
                        onClick={() => loadInsights(sessionId)}
                        className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                        style={{ backgroundColor: "#f5f1ea", color: "#4a7c59" }}
                      >
                        Retry
                      </button>
                    </div>
                  )}
                  {!insightLoading && !insightError && !understanding && (
                    <div className="flex flex-col items-center gap-3 px-3 py-8 text-center">
                      <svg className="w-6 h-6" style={{ color: "#D0C4B0" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                      </svg>
                      <p className="text-xs" style={{ color: "#74796e" }}>No ideas yet.</p>
                      <button
                        onClick={() => loadInsights(sessionId)}
                        className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                        style={{ backgroundColor: "#f5f1ea", color: "#4a7c59" }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#eae6de")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#f5f1ea")}
                      >
                        Generate ideas
                      </button>
                    </div>
                  )}
                  {!insightLoading && understanding && understanding.suggestedQuestions.length === 0 && (
                    <p className="text-xs text-center px-3 py-8" style={{ color: "#74796e" }}>No question ideas were generated.</p>
                  )}
                  {understanding?.suggestedQuestions.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => handleQuestionClick(q)}
                      className="w-full text-left text-sm px-3 py-2.5 rounded-xl leading-snug transition-colors"
                      style={{ backgroundColor: "#f5f1ea", border: "1px solid #eae6de", color: "#2e3230" }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#4a7c59"; e.currentTarget.style.backgroundColor = "#F0E8D8"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#eae6de"; e.currentTarget.style.backgroundColor = "#f5f1ea"; }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </Panel>
          )}

        </Group>
      </div>

      {/* Expand right button when collapsed */}
      {!isLargeSchema && rightCollapsed && (
        <button
          onClick={toggleRight}
          title="Show question ideas"
          className="fixed right-3 top-14 z-10 rounded-lg p-1.5 shadow-sm transition-colors"
          style={{ backgroundColor: "#faf6f0", border: "1px solid #e8e0d4", color: "#74796e" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#4a7c59")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#74796e")}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7M18 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {/* Share modal */}
      {showShareModal && shareToken && (
        <div className="fixed inset-0 flex items-center justify-center z-50 px-4" style={{ backgroundColor: "rgba(28,23,20,0.5)" }} onClick={() => setShowShareModal(false)}>
          <div className="rounded-2xl p-6 w-full max-w-md space-y-4" style={{ backgroundColor: "#faf6f0", border: "1px solid #e8e0d4" }} onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold text-lg" style={{ color: "#2e3230" }}>Share session</h2>
            <p className="text-sm" style={{ color: "#4a4e4a" }}>Anyone with this link can view in read-only mode.</p>
            <div className="flex gap-2">
              <input
                readOnly
                value={`${window.location.origin}/share/${shareToken}`}
                className="flex-1 rounded-xl px-3 py-2 text-sm min-w-0 outline-none"
                style={{ backgroundColor: "#f5f1ea", border: "1px solid #E0D5C5", color: "#2e3230" }}
              />
              <button
                onClick={handleCopyShare}
                className="shrink-0 text-sm font-medium px-3 py-2 rounded-xl transition-colors"
                style={{ backgroundColor: "#4a7c59", color: "#faf6f0" }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#3a6447")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#4a7c59")}
              >
                {shareCopied ? "Copied!" : "Copy"}
              </button>
            </div>
            <div className="flex justify-between pt-1">
              <button onClick={handleRevokeShare} className="text-sm transition-colors" style={{ color: "#C0392B" }}>Revoke access</button>
              <button onClick={() => setShowShareModal(false)} className="text-sm transition-colors" style={{ color: "#4a4e4a" }}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ResizeHandle() {
  return (
    <Separator
      className="w-1 transition-colors cursor-col-resize"
      style={{ backgroundColor: "#e8e0d4" }}
      onMouseEnter={(e) => ((e.target as HTMLElement).style.backgroundColor = "#4a7c59")}
      onMouseLeave={(e) => ((e.target as HTMLElement).style.backgroundColor = "#e8e0d4")}
    />
  );
}
