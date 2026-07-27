"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "../lib/authClient";
import { listSessions, searchSessions, deleteSession, shareSession, revokeShare, type AppSession } from "../lib/api";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins !== 1 ? "s" : ""} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? "s" : ""} ago`;
}

function formatShortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function SessionIcon({ sourceType, size = "sm" }: { sourceType: "csv" | "database"; size?: "sm" | "lg" }) {
  const sz = size === "lg" ? "w-12 h-12 rounded-xl" : "w-9 h-9 rounded-lg";
  if (sourceType === "database") {
    return (
      <div className={`${sz} flex items-center justify-center shrink-0`} style={{ backgroundColor: "rgba(74,124,89,0.12)" }}>
        <svg className={size === "lg" ? "w-6 h-6" : "w-4 h-4"} style={{ color: "#4a7c59" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 2.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
        </svg>
      </div>
    );
  }
  return (
    <div className={`${sz} flex items-center justify-center shrink-0`} style={{ backgroundColor: "rgba(112,92,48,0.1)" }}>
      <svg className={size === "lg" ? "w-6 h-6" : "w-4 h-4"} style={{ color: "#705c30" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    </div>
  );
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [allSessions, setAllSessions] = useState<AppSession[]>([]);
  const [sessions, setSessions] = useState<AppSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shareModal, setShareModal] = useState<{ sessionId: string; shareUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const data = await listSessions();
      setAllSessions(data);
      setSessions(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Debounced semantic search
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (!query.trim()) {
      setSessions(allSessions);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchSessions(query);
        setSessions(results.length > 0 ? results : allSessions.filter((s) =>
          s.name.toLowerCase().includes(query.toLowerCase())
        ));
      } catch {
        // Fall back to client-side filter
        setSessions(allSessions.filter((s) => s.name.toLowerCase().includes(query.toLowerCase())));
      } finally {
        setSearching(false);
      }
    }, 400);
  }, [query, allSessions]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this session? This cannot be undone.")) return;
    await deleteSession(id);
    setAllSessions((prev) => prev.filter((s) => s.id !== id));
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setOpenMenu(null);
  };

  const handleShare = async (s: AppSession) => {
    setOpenMenu(null);
    if (s.shareToken) {
      const url = `${window.location.origin}/share/${s.shareToken}`;
      setShareModal({ sessionId: s.id, shareUrl: url });
      return;
    }
    const { shareUrl } = await shareSession(s.id);
    setSessions((prev) => prev.map((x) => x.id === s.id ? { ...x, shareToken: shareUrl.split("/share/")[1]! } : x));
    setShareModal({ sessionId: s.id, shareUrl });
  };

  const handleRevokeShare = async () => {
    if (!shareModal) return;
    await revokeShare(shareModal.sessionId);
    setSessions((prev) => prev.map((x) => x.id === shareModal.sessionId ? { ...x, shareToken: null } : x));
    setShareModal(null);
  };

  const handleCopy = () => {
    if (!shareModal) return;
    navigator.clipboard.writeText(shareModal.shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    if (openMenu) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenu]);

  const [featured, second, ...rest] = sessions;

  const ThreeDotsMenu = ({ s }: { s: AppSession }) => (
    <div className="relative" ref={openMenu === s.id ? menuRef : undefined}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === s.id ? null : s.id); }}
        className="p-1.5 rounded-lg transition-colors hover:bg-black/5"
        style={{ color: "#74796e" }}
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
        </svg>
      </button>
      {openMenu === s.id && (
        <div
          className="absolute right-0 top-8 z-20 w-40 rounded-xl shadow-lg border overflow-hidden"
          style={{ backgroundColor: "#faf6f0", borderColor: "#e8e0d4" }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handleShare(s)}
            className="w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-black/5"
            style={{ color: "#2e3230" }}
          >
            Share
          </button>
          <button
            onClick={() => handleDelete(s.id)}
            className="w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-red-50"
            style={{ color: "#C0392B" }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#F2EDE3" }}>
      {/* Nav */}
      <nav
        className="px-6 py-4 flex items-center justify-between border-b"
        style={{ backgroundColor: "#faf6f0", borderColor: "#e8e0d4" }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: "#4a7c59" }}
          >
            <svg className="w-4 h-4" style={{ color: "#3D2B0E" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          <span className="font-semibold" style={{ color: "#2e3230" }}>Clairvoyance</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm" style={{ color: "#74796e" }}>{session?.user.email}</span>
          <button
            onClick={() => router.push("/")}
            className="text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            style={{ backgroundColor: "#1e4d2b", color: "#ffffff" }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#163a20")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#1e4d2b")}
          >
            + New Analysis
          </button>
          <button
            onClick={() => signOut().then(() => router.push("/sign-in"))}
            className="text-sm transition-colors"
            style={{ color: "#74796e" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#2e3230")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#74796e")}
          >
            Sign out
          </button>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-6 py-10">
        {/* Header row */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#2e3230", fontFamily: "Georgia, 'Times New Roman', serif" }}>
              Your Sessions
            </h1>
            <p className="text-sm mt-1.5" style={{ color: "#4a4e4a" }}>
              Pick up where you left off or start a new analysis.
            </p>
          </div>
          {/* Search */}
          <div className="relative">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sessions…"
              className="w-64 rounded-xl pl-9 pr-4 py-2.5 text-sm outline-none transition-all border"
              style={{
                backgroundColor: "#faf6f0",
                borderColor: "#E0D5C5",
                color: "#2e3230",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "#4a7c59")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "#E0D5C5")}
            />
            <div className="absolute left-3 top-3">
              {searching ? (
                <div className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "#4a7c59", borderTopColor: "transparent" }} />
              ) : (
                <svg className="w-3.5 h-3.5" style={{ color: "#74796e" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              )}
            </div>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "#4a7c59", borderTopColor: "transparent" }} />
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="text-sm rounded-xl px-4 py-3 border" style={{ color: "#C0392B", backgroundColor: "#FEF2F0", borderColor: "#F5C6C0" }}>{error}</p>
        )}

        {/* Empty state */}
        {!loading && sessions.length === 0 && (
          <div className="text-center py-24 space-y-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto" style={{ backgroundColor: "#e8e0d4" }}>
              <svg className="w-7 h-7" style={{ color: "#74796e" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              </svg>
            </div>
            <p className="text-sm" style={{ color: "#74796e" }}>No sessions yet.</p>
            <button
              onClick={() => router.push("/")}
              className="text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
              style={{ backgroundColor: "#4a7c59", color: "#3D2B0E" }}
            >
              Upload your first dataset
            </button>
          </div>
        )}

        {/* Sessions grid */}
        {!loading && sessions.length > 0 && (
          <>
            {/* Top row: featured (2/3) + second card (1/3) */}
            <div className="grid grid-cols-3 gap-4 mb-4">
              {/* Featured card */}
              {featured && (
                <div
                  className="col-span-2 rounded-2xl overflow-hidden border relative"
                  style={{ backgroundColor: "#faf6f0", borderColor: "#e8e0d4" }}
                >
                  {/* Preview strip on right */}
                  <div
                    className="absolute right-0 top-0 bottom-0 w-56 pointer-events-none"
                    style={{ background: "linear-gradient(to left, #E0D4C0 0%, #EDE6D8 60%, transparent 100%)" }}
                  />
                  <div className="relative p-6 flex flex-col h-full min-h-[220px]">
                    <div className="flex items-start gap-4">
                      <SessionIcon sourceType={featured.sourceType} size="lg" />
                      <div className="flex-1 min-w-0 pr-48">
                        <h2 className="text-xl font-bold leading-snug truncate" style={{ color: "#2e3230" }}>
                          {featured.name}
                        </h2>
                        <div className="flex items-center gap-1.5 mt-1">
                          <svg className="w-3.5 h-3.5 shrink-0" style={{ color: "#74796e" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            {featured.sourceType === "database"
                              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                            }
                          </svg>
                          <span className="text-sm truncate" style={{ color: "#74796e" }}>
                            {featured.sourceType === "database" ? "database" : "csv file"}
                          </span>
                        </div>
                      </div>
                      <ThreeDotsMenu s={featured} />
                    </div>

                    {/* Tags */}
                    {featured.tags.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-5">
                        {featured.tags.map((tag, i) => (
                          <span
                            key={tag}
                            className="text-xs px-3 py-1 rounded-full border font-medium"
                            style={i === featured.tags.length - 1 && featured.tags.length > 1
                              ? { backgroundColor: "#F5ECD8", borderColor: "#DFC89A", color: "#7A5220" }
                              : { backgroundColor: "#eae6de", borderColor: "#D8D0C4", color: "#5C5248" }
                            }
                          >
                            {tag}
                          </span>
                        ))}
                        {featured.shareToken && (
                          <span className="text-xs px-3 py-1 rounded-full border font-medium" style={{ backgroundColor: "#EDF5F0", borderColor: "#AEDCC0", color: "#2E7D52" }}>
                            Shared
                          </span>
                        )}
                      </div>
                    )}

                    {/* Footer: last active + open button */}
                    <div className="flex items-center justify-between mt-auto pt-5">
                      <div className="flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" style={{ color: "#74796e" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-xs" style={{ color: "#74796e" }}>Last active: {timeAgo(featured.updatedAt)}</span>
                      </div>
                      <button
                      onClick={() => router.push(`/session/${featured.id}`)}
                        className="text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                        style={{ backgroundColor: "#e8e0d4", color: "#5C4A35" }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#DDD0BF")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#e8e0d4")}
                      >
                        Open →
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Second card (compact) */}
              {second && (
                <div
                  className="rounded-2xl border p-5 flex flex-col cursor-pointer transition-all hover:shadow-sm"
                  style={{ backgroundColor: "#faf6f0", borderColor: "#e8e0d4" }}
                  onClick={() => router.push(`/session/${second.id}`)}
                >
                  <div className="flex items-start justify-between mb-4">
                    <SessionIcon sourceType={second.sourceType} />
                    <ThreeDotsMenu s={second} />
                  </div>
                  <h3 className="font-bold text-base leading-snug" style={{ color: "#2e3230" }}>{second.name}</h3>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <svg className="w-3.5 h-3.5 shrink-0" style={{ color: "#74796e" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <span className="text-sm truncate" style={{ color: "#74796e" }}>
                      {second.sourceType === "database" ? "database" : "csv file"}
                    </span>
                  </div>
                  <div className="mt-auto pt-4 flex items-center justify-between">
                    <div className="flex flex-wrap gap-1.5">
                      {second.tags.slice(0, 2).map((tag) => (
                        <span key={tag} className="text-xs px-2.5 py-0.5 rounded-full border" style={{ backgroundColor: "#eae6de", borderColor: "#D8D0C4", color: "#5C5248" }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                    <span className="text-xs shrink-0" style={{ color: "#74796e" }}>{formatShortDate(second.updatedAt)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Remaining sessions in 3-col grid */}
            {rest.length > 0 && (
              <div className="grid grid-cols-3 gap-4">
                {rest.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-2xl border p-5 flex flex-col cursor-pointer transition-all hover:shadow-sm"
                    style={{ backgroundColor: "#faf6f0", borderColor: "#e8e0d4" }}
                    onClick={() => router.push(`/session/${s.id}`)}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <SessionIcon sourceType={s.sourceType} />
                      <ThreeDotsMenu s={s} />
                    </div>
                    <h3 className="font-bold text-base leading-snug" style={{ color: "#2e3230" }}>{s.name}</h3>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <svg className="w-3.5 h-3.5 shrink-0" style={{ color: "#74796e" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      <span className="text-sm truncate" style={{ color: "#74796e" }}>
                        {s.sourceType === "database" ? "database" : "csv file"}
                      </span>
                    </div>
                    <div className="mt-auto pt-4 flex items-center justify-between">
                      <div className="flex flex-wrap gap-1.5">
                        {s.tags.slice(0, 2).map((tag) => (
                          <span key={tag} className="text-xs px-2.5 py-0.5 rounded-full border" style={{ backgroundColor: "#eae6de", borderColor: "#D8D0C4", color: "#5C5248" }}>
                            {tag}
                          </span>
                        ))}
                        {s.shareToken && (
                          <span className="text-xs px-2.5 py-0.5 rounded-full border" style={{ backgroundColor: "#EDF5F0", borderColor: "#AEDCC0", color: "#2E7D52" }}>
                            Shared
                          </span>
                        )}
                      </div>
                      <span className="text-xs shrink-0" style={{ color: "#74796e" }}>{formatShortDate(s.updatedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* Share modal */}
      {shareModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={() => setShareModal(null)}>
          <div
            className="rounded-2xl p-6 w-full max-w-md space-y-4 border shadow-xl"
            style={{ backgroundColor: "#faf6f0", borderColor: "#e8e0d4" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-bold text-lg" style={{ color: "#2e3230" }}>Share session</h2>
            <p className="text-sm" style={{ color: "#4a4e4a" }}>Anyone with this link can view this session in read-only mode.</p>
            <div className="flex gap-2">
              <input
                readOnly
                value={shareModal.shareUrl}
                className="flex-1 rounded-lg px-3 py-2 text-sm min-w-0 border outline-none"
                style={{ backgroundColor: "#F2EDE3", borderColor: "#E0D5C5", color: "#2e3230" }}
              />
              <button
                onClick={handleCopy}
                className="shrink-0 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                style={{ backgroundColor: "#4a7c59", color: "#3D2B0E" }}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <div className="flex justify-between pt-1">
              <button onClick={handleRevokeShare} className="text-sm transition-colors" style={{ color: "#C0392B" }}>
                Revoke access
              </button>
              <button onClick={() => setShareModal(null)} className="text-sm transition-colors" style={{ color: "#4a4e4a" }}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
