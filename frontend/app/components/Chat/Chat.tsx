"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { streamQuery, toAnswer, type Answer, type DataUnderstanding, type StoredMessage, type StreamEvent } from "../../lib/api";
import AnswerCard from "../Answer/AnswerCard";
import { Icon, Spinner } from "../ui";

type Item =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; answer: Answer; question: string }
  | { id: string; role: "error"; text: string; question: string };

type HistoryTurn = { role: "user" | "assistant"; content: string; sql?: string };

interface Status { id: string; label: string; detail?: string; state: "active" | "done" | "error" }

interface Props {
  sessionId: string;
  initialMessages: StoredMessage[];
  understanding: DataUnderstanding | null;
  understandingState: "loading" | "ready" | "error";
  onRetryUnderstanding: () => void;
  onOpenData: () => void;
  /** Lets the page (e.g. the data drawer) ask a question in this conversation */
  askRef?: React.RefObject<((q: string) => void) | null>;
}

const FALLBACK_QUESTIONS = [
  "Give me a quick overview of this data",
  "What changed the most over time?",
  "What are the top 10 by total?",
  "Is anything unusual or surprising here?",
];

let counter = 0;
const nextId = () => `m${Date.now()}-${counter++}`;

function fromStored(messages: StoredMessage[]): Item[] {
  const items: Item[] = [];
  let lastQuestion = "";
  for (const m of messages) {
    if (m.role === "user") {
      lastQuestion = m.content.text ?? "";
      items.push({ id: m.id, role: "user", text: lastQuestion });
    } else {
      items.push({ id: m.id, role: "assistant", answer: toAnswer(m.content), question: lastQuestion });
    }
  }
  return items;
}

/** Plain-text version of an answer for conversation history. */
function answerText(a: Answer): string {
  return [a.headline, ...a.insights].join("\n");
}

export default function Chat({ sessionId, initialMessages, understanding, understandingState, onRetryUnderstanding, onOpenData, askRef }: Props) {
  const [items, setItems] = useState<Item[]>(() => fromStored(initialMessages));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items.length, busy, statuses.length]);

  const ask = useCallback(async (raw: string) => {
    const question = raw.trim();
    if (!question || busy) return;

    const history = items.flatMap((it): HistoryTurn[] =>
      it.role === "user" ? [{ role: "user", content: it.text }]
        : it.role === "assistant" ? [{ role: "assistant", content: answerText(it.answer), sql: it.answer.sql }]
        : []
    );

    setItems((prev) => [...prev, { id: nextId(), role: "user", text: question }]);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setBusy(true);
    setElapsed(0);
    setStatuses([]);

    const controller = new AbortController();
    abortRef.current = controller;
    let answer: Answer | null = null;
    let error: string | null = null;

    try {
      await streamQuery(sessionId, question, history, (e: StreamEvent) => {
        if (e.type === "status") {
          setStatuses((prev) => {
            const i = prev.findIndex((s) => s.id === e.id);
            if (i === -1) return [...prev, { id: e.id, label: e.label, detail: e.detail, state: e.state }];
            const copy = [...prev];
            copy[i] = { ...copy[i]!, ...e, detail: e.detail ?? copy[i]!.detail };
            return copy;
          });
        } else if (e.type === "result") {
          answer = e.answer;
        } else if (e.type === "error") {
          error = e.message;
        }
      }, controller.signal);
    } catch (err) {
      error = (err as Error).name === "AbortError" ? "Stopped." : (err as Error).message;
    }

    abortRef.current = null;
    setBusy(false);
    setStatuses([]);
    const finalAnswer = answer as Answer | null;
    setItems((prev) => [
      ...prev,
      finalAnswer
        ? { id: nextId(), role: "assistant", answer: finalAnswer, question }
        : { id: nextId(), role: "error", text: error ?? "No answer came back. Please try again.", question },
    ]);
  }, [busy, items, sessionId]);

  useEffect(() => {
    if (askRef) askRef.current = ask;
  }, [ask, askRef]);

  const stop = () => abortRef.current?.abort();

  const suggestions = understanding?.suggestedQuestions?.length ? understanding.suggestedQuestions.slice(0, 6) : FALLBACK_QUESTIONS;
  const empty = items.length === 0 && !busy;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-8 sm:px-6">
          {empty && (
            <Welcome
              understanding={understanding}
              state={understandingState}
              suggestions={suggestions}
              onAsk={ask}
              onRetry={onRetryUnderstanding}
              onOpenData={onOpenData}
            />
          )}

          <div className="space-y-6">
            {items.map((it) =>
              it.role === "user" ? (
                <div key={it.id} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-[15px] leading-relaxed text-white">
                    {it.text}
                  </p>
                </div>
              ) : it.role === "assistant" ? (
                <AnswerCard key={it.id} answer={it.answer} question={it.question} onAsk={ask} />
              ) : (
                <div key={it.id} className="flex items-start justify-between gap-4 rounded-2xl border border-danger/20 bg-danger-soft px-5 py-4 text-sm text-danger">
                  <p>{it.text}</p>
                  <button onClick={() => ask(it.question)} className="shrink-0 font-semibold underline-offset-2 hover:underline">Try again</button>
                </div>
              )
            )}

            {busy && <Progress statuses={statuses} elapsed={elapsed} onStop={stop} />}
          </div>
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-line/70 bg-canvas/90 backdrop-blur">
        <form
          className="mx-auto w-full max-w-3xl px-4 py-3 sm:px-6"
          onSubmit={(e) => { e.preventDefault(); ask(input); }}
        >
          <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface p-2 pl-4 shadow-[var(--shadow-card)] transition-colors focus-within:border-brand/60">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  ask(input);
                }
              }}
              placeholder={empty ? "Ask anything about your data…" : "Ask a follow-up…"}
              aria-label="Your question"
              className="max-h-40 min-h-[28px] flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-3"
            />
            {busy ? (
              <button type="button" onClick={stop} aria-label="Stop"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sunken text-ink-2 hover:bg-line">
                <Icon name="stop" className="h-4 w-4" />
              </button>
            ) : (
              <button type="submit" disabled={!input.trim()} aria-label="Ask"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-white transition-colors hover:bg-brand-strong disabled:bg-sunken disabled:text-ink-3">
                <Icon name="send" className="h-4 w-4" strokeWidth={2} />
              </button>
            )}
          </div>
          <p className="mt-1.5 hidden text-center text-[11px] text-ink-3 sm:block">
            Enter to ask · Shift + Enter for a new line · Answers are read-only — your data is never changed
          </p>
        </form>
      </div>
    </div>
  );
}

function Welcome({
  understanding, state, suggestions, onAsk, onRetry, onOpenData,
}: {
  understanding: DataUnderstanding | null;
  state: Props["understandingState"];
  suggestions: string[];
  onAsk: (q: string) => void;
  onRetry: () => void;
  onOpenData: () => void;
}) {
  return (
    <div className="animate-rise mb-8">
      <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-ink sm:text-[32px]">What would you like to know?</h1>

      <div className="mt-3 min-h-[48px] text-[15px] leading-relaxed text-ink-2">
        {understanding ? (
          <p>
            {understanding.summary}{" "}
            <button onClick={onOpenData} className="font-semibold text-brand hover:underline">What&apos;s in this data?</button>
          </p>
        ) : state === "loading" ? (
          <div className="space-y-2" aria-label="Getting to know your data">
            <p className="flex items-center gap-2 text-sm text-ink-3"><Spinner className="h-3.5 w-3.5" /> Getting to know your data… you can start asking right away.</p>
            <div className="skeleton h-3.5 w-11/12" />
            <div className="skeleton h-3.5 w-8/12" />
          </div>
        ) : (
          <p className="text-sm text-ink-3">
            Couldn&apos;t prepare a summary of this data.{" "}
            <button onClick={onRetry} className="font-semibold text-brand hover:underline">Try again</button>
            {" "}— you can still ask questions.
          </p>
        )}
      </div>

      <p className="mb-3 mt-7 text-[13px] font-semibold uppercase tracking-wide text-ink-3">
        {understanding ? "Try asking" : "Some ideas"}
      </p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {suggestions.map((q) => (
          <button key={q} onClick={() => onAsk(q)}
            className="group flex items-start gap-3 rounded-xl border border-line bg-surface p-3.5 text-left text-[14px] leading-snug text-ink shadow-[var(--shadow-card)] transition-colors hover:border-brand/40 hover:bg-brand-soft/40">
            <Icon name="sparkle" className="mt-0.5 h-4 w-4 shrink-0 text-brand opacity-70 group-hover:opacity-100" />
            <span>{q}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Progress({ statuses, elapsed, onStop }: { statuses: Status[]; elapsed: number; onStop: () => void }) {
  const visible = statuses.length ? statuses : [{ id: "start", label: "Understanding your question", state: "active" as const }];
  return (
    <div className="animate-rise rounded-2xl border border-line bg-surface px-5 py-4 shadow-[var(--shadow-card)]" aria-live="polite">
      <div className="mb-2 flex items-center justify-between text-xs text-ink-3">
        <span className="font-semibold uppercase tracking-wide">Working on it</span>
        <span className="flex items-center gap-3 tabular-nums">
          {elapsed}s
          <button onClick={onStop} className="font-semibold text-ink-2 hover:text-ink">Stop</button>
        </span>
      </div>
      <ul className="space-y-1.5">
        {visible.map((s) => (
          <li key={s.id} className="flex items-start gap-2.5 text-sm">
            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center ${s.state === "done" ? "text-brand" : "text-ink-3"}`}>
              {s.state === "active" ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="check" className="h-4 w-4" strokeWidth={2.2} />}
            </span>
            <span className={s.state === "active" ? "text-ink" : "text-ink-2"}>
              {s.label}
              {s.detail && <span className="text-ink-3"> · {s.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
