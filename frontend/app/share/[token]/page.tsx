"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getSharedSession } from "../../lib/api";
import type { AppMessage, AppSession } from "../../lib/api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type SharedSession = Omit<AppSession, "shareToken" | "updatedAt" | "expiresAt">;

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [session, setSession] = useState<SharedSession | null>(null);
  const [msgs, setMsgs] = useState<AppMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    getSharedSession(token)
      .then(({ session, messages }) => {
        setSession(session);
        setMsgs(messages);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#faf6f0" }}>
        <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "#4a7c59", borderTopColor: "transparent" }} />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: "#faf6f0" }}>
        <div className="text-center space-y-2">
          <p className="font-medium" style={{ color: "#2e3230" }}>Session not found</p>
          <p className="text-sm" style={{ color: "#74796e" }}>{error ?? "This share link may have been revoked."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#faf6f0" }}>
      {/* Nav */}
      <nav className="border-b px-6 py-4 flex items-center justify-between" style={{ backgroundColor: "#faf6f0", borderColor: "#e8e0d4" }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: "#4a7c59" }}>
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          <span className="font-semibold" style={{ color: "#2e3230" }}>Clairvoyance</span>
          <span className="text-xs px-2 py-0.5 rounded-full ml-2 border" style={{ backgroundColor: "rgba(112,92,48,0.08)", color: "#705c30", borderColor: "rgba(112,92,48,0.2)" }}>Read-only</span>
        </div>
      </nav>

      {/* Session header */}
      <div className="max-w-3xl mx-auto px-6 pt-8 pb-4">
        <h1 className="text-xl font-semibold" style={{ color: "#2e3230" }}>{session.name}</h1>
        {session.tags.length > 0 && (
          <div className="flex gap-2 mt-2">
            {session.tags.map((tag) => (
              <span key={tag} className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: "#eae6de", color: "#74796e" }}>{tag}</span>
            ))}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="max-w-3xl mx-auto px-6 pb-16 space-y-6">
        {msgs.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className="max-w-[85%] rounded-2xl px-4 py-3 text-sm"
              style={msg.role === "user"
                ? { backgroundColor: "#4a7c59", color: "#ffffff" }
                : { backgroundColor: "#ffffff", border: "1px solid #e8e0d4", color: "#2e3230" }
              }
            >
              {msg.role === "user" ? (
                <p>{msg.content.text}</p>
              ) : (
                <div className="prose prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content.answer ?? ""}
                  </ReactMarkdown>
                  {msg.content.sql && (
                    <pre className="mt-2 rounded-lg p-3 text-xs overflow-x-auto border" style={{ backgroundColor: "#f5f1ea", borderColor: "#e8e0d4" }}>
                      <code>{msg.content.sql}</code>
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {msgs.length === 0 && (
          <p className="text-center py-10 text-sm" style={{ color: "#74796e" }}>No messages in this session.</p>
        )}
      </div>
    </div>
  );
}
