"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AnswerCard from "../../components/Answer/AnswerCard";
import { Logo, Spinner } from "../../components/ui";
import { getSharedSession, toAnswer, type StoredMessage } from "../../lib/api";

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<{ name: string; createdAt: string; messages: StoredMessage[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    getSharedSession(token)
      .then(({ session, messages }) => setData({ name: session.name, createdAt: session.createdAt, messages }))
      .catch((e: Error) => setError(e.message));
  }, [token]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-lg font-semibold text-ink">This link isn&apos;t available</p>
        <p className="text-sm text-ink-3">It may have been turned off by its owner.</p>
      </div>
    );
  }
  if (!data) {
    return <div className="flex min-h-screen items-center justify-center text-brand"><Spinner className="h-6 w-6" /></div>;
  }

  const questions = questionsFor(data.messages);
  return (
    <div className="min-h-screen">
      <header className="border-b border-line/70 bg-canvas/90">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link href="/"><Logo /></Link>
          <span className="rounded-full bg-sunken px-2.5 py-0.5 text-xs font-semibold text-ink-2">Read-only</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-20 pt-8 sm:px-6">
        <h1 className="text-[28px] font-semibold tracking-tight text-ink">{data.name}</h1>
        <p className="mt-1 text-sm text-ink-3">
          Shared analysis · {new Date(data.createdAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
        </p>
        <div className="mt-8 space-y-6">
          {data.messages.length === 0 && <p className="text-sm text-ink-3">No questions have been asked yet.</p>}
          {data.messages.map((m, i) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-[15px] text-white">{m.content.text}</p>
              </div>
            ) : (
              <AnswerCard key={m.id} answer={toAnswer(m.content)} question={questions[i]} />
            )
          )}
        </div>
      </main>
    </div>
  );
}

/** For each message, the most recent question asked before it. */
function questionsFor(messages: StoredMessage[]): string[] {
  const out: string[] = [];
  let last = "";
  for (const m of messages) {
    if (m.role === "user") last = m.content.text ?? "";
    out.push(last);
  }
  return out;
}
