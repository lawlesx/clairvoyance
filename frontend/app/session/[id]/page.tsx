"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import Chat from "../../components/Chat/Chat";
import DataPanel from "../../components/DataPanel/DataPanel";
import { Button, Icon, Logo, Modal, Spinner } from "../../components/ui";
import {
  analyzeSession, getSession, revokeShare, shareSession, updateSession,
  type AppSession, type DataUnderstanding, type StoredMessage,
} from "../../lib/api";

export default function SessionPage() {
  const { id: sessionId } = useParams<{ id: string }>();
  const router = useRouter();

  const [session, setSession] = useState<AppSession | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [understanding, setUnderstanding] = useState<DataUnderstanding | null>(null);
  const [understandingState, setUnderstandingState] = useState<"loading" | "ready" | "error">("loading");
  const [dataOpen, setDataOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const askRef = useRef<((q: string) => void) | null>(null);

  const loadUnderstanding = useCallback(async (refresh = false) => {
    setUnderstandingState("loading");
    try {
      setUnderstanding(await analyzeSession(sessionId, refresh));
      setUnderstandingState("ready");
    } catch {
      setUnderstandingState("error");
    }
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    getSession(sessionId)
      .then(({ session: s, messages: m, understanding: u }) => {
        if (cancelled) return;
        setSession(s);
        setName(s.name);
        setShareToken(s.shareToken);
        setMessages(m);
        if (u) {
          setUnderstanding(u);
          setUnderstandingState("ready");
        } else {
          // Still being prepared in the background (or never was) — wait for it.
          loadUnderstanding();
        }
      })
      .catch((e: Error) => { if (!cancelled) setLoadError(e.message); });
    return () => { cancelled = true; };
  }, [sessionId, loadUnderstanding]);

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === session?.name) { setName(session?.name ?? ""); return; }
    try {
      await updateSession(sessionId, { name: trimmed });
      setSession((s) => (s ? { ...s, name: trimmed } : s));
    } catch { /* keep local edit */ }
  };

  const openShare = async () => {
    if (!shareToken) {
      const { shareToken: token } = await shareSession(sessionId);
      setShareToken(token);
    }
    setShareOpen(true);
  };

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-lg font-semibold text-ink">We couldn&apos;t open this analysis.</p>
        <p className="text-sm text-ink-3">{loadError}</p>
        <Button variant="primary" onClick={() => router.push("/dashboard")}>Back to my analyses</Button>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center text-brand">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const shareUrl = shareToken && typeof window !== "undefined" ? `${window.location.origin}/share/${shareToken}` : "";

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-canvas/95 px-3 backdrop-blur sm:px-5">
        <Link href="/dashboard" className="shrink-0 rounded-lg p-1 hover:bg-sunken" aria-label="All analyses">
          <Logo size="sm" withText={false} />
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            aria-label="Analysis name"
            className="min-w-[8ch] max-w-[min(340px,45vw)] truncate rounded-lg [field-sizing:content] bg-transparent px-2 py-1 text-[15px] font-semibold text-ink outline-none hover:bg-sunken focus:bg-surface focus:ring-2 focus:ring-brand/30"
          />
          <span className="hidden items-center gap-1 rounded-full bg-sunken px-2.5 py-0.5 text-xs text-ink-2 sm:inline-flex">
            <Icon name={session.sourceType === "database" ? "database" : "file"} className="h-3.5 w-3.5" />
            {understanding?.domain ?? (session.sourceType === "database" ? "Live database" : "Uploaded file")}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setDataOpen(true)}>
          <Icon name="book" /> <span className="hidden sm:inline">About this data</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={openShare} aria-label="Share">
          <Icon name="share" /> <span className="hidden md:inline">Share</span>
        </Button>
        <Button variant="secondary" size="sm" onClick={() => router.push("/")}>
          <Icon name="plus" /> <span className="hidden md:inline">New</span>
        </Button>
      </header>

      <main className="min-h-0 flex-1">
        <Chat
          sessionId={sessionId}
          initialMessages={messages}
          understanding={understanding}
          understandingState={understandingState}
          onRetryUnderstanding={() => loadUnderstanding()}
          onOpenData={() => setDataOpen(true)}
          askRef={askRef}
        />
      </main>

      <DataPanel
        open={dataOpen}
        onClose={() => setDataOpen(false)}
        sessionId={sessionId}
        sourceType={session.sourceType}
        understanding={understanding}
        understandingState={understandingState}
        onRefresh={() => loadUnderstanding(true)}
        onAsk={(q) => askRef.current?.(q)}
      />

      <Modal open={shareOpen} onClose={() => setShareOpen(false)} title="Share this analysis">
        <p className="mb-4 text-sm text-ink-2">Anyone with the link can read the questions and answers. They can&apos;t ask new questions or see your connection details.</p>
        <div className="flex gap-2">
          <input readOnly value={shareUrl} onFocus={(e) => e.target.select()}
            className="min-w-0 flex-1 rounded-xl border border-line bg-sunken px-3 py-2 text-sm text-ink outline-none" />
          <Button variant="primary" onClick={() => { navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); }}>
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
        <div className="mt-5 flex justify-between">
          <Button variant="danger" size="sm" onClick={async () => { await revokeShare(sessionId); setShareToken(null); setShareOpen(false); }}>
            Turn off link
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShareOpen(false)}>Done</Button>
        </div>
      </Modal>
    </div>
  );
}
