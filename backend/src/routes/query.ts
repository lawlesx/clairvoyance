import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { eq } from "drizzle-orm";
import { runAgent, type HistoryTurn, type StreamEvent } from "../agents/orchestrator";
import { answerToMarkdown, type AnswerPayload } from "../agents/visual";
import type { DataUnderstanding } from "../agents/dataAnalyst";
import { db as pgDb } from "../db/pgClient";
import { appSessions, messages } from "../db/schema";
import { getOwnedSession, loadDataSource, SourceError } from "../db/dataSource";
import { getSessionUnderstanding } from "../db/understandingCache";
import type { AppEnv } from "../types";

export const queryRouter = new Hono<AppEnv>();

interface QueryBody {
  sessionId?: string;
  question?: string;
  history?: HistoryTurn[];
}

async function persistTurn(sessionId: string, question: string, answer: AnswerPayload) {
  try {
    const markdown = answerToMarkdown(answer);
    let embeddings: number[][] = [];
    if (process.env.VOYAGE_API_KEY) {
      const { embedBatch } = await import("../lib/embeddings");
      embeddings = await embedBatch([question, markdown]).catch(() => []);
    }
    await pgDb.insert(messages).values([
      { sessionId, role: "user", content: { text: question }, embedding: embeddings[0] },
      // `answer` (markdown) is kept for search and for older clients.
      { sessionId, role: "assistant", content: { ...answer, answer: markdown }, embedding: embeddings[1] },
    ]);
    await pgDb.update(appSessions).set({ updatedAt: new Date() }).where(eq(appSessions.id, sessionId));
  } catch (e) {
    console.warn("Failed to persist messages:", e);
  }
}

// Streaming endpoint — emits SSE status events while the agent works, then the answer.
queryRouter.post("/stream", async (c) => {
  const user = c.get("user");
  const { sessionId, question, history = [] } = (await c.req.json().catch(() => ({}))) as QueryBody;
  if (!sessionId) return c.json({ error: "sessionId is required" }, 400);
  if (!question?.trim()) return c.json({ error: "question is required" }, 400);

  const session = await getOwnedSession(sessionId, user.id);
  if (!session) return c.json({ error: "Session not found" }, 404);

  let source;
  try {
    source = await loadDataSource(session);
  } catch (e) {
    if (e instanceof SourceError) return c.json({ error: e.message }, e.status);
    return c.json({ error: `Couldn't reach your data: ${(e as Error).message}` }, 502);
  }
  const understanding =
    (await getSessionUnderstanding(sessionId)) ?? undefined;

  return streamSSE(c, async (stream) => {
    const controller = new AbortController();
    // Keep proxies and the connection from timing out during long model turns.
    const heartbeat = setInterval(() => { stream.write(": keep-alive\n\n").catch(() => {}); }, 15_000);
    stream.onAbort(() => { controller.abort(); clearInterval(heartbeat); });
    const emit = async (event: StreamEvent) => {
      if (!controller.signal.aborted) await stream.writeSSE({ data: JSON.stringify(event), event: event.type });
    };

    try {
      const answer = await runAgent({
        question: question.trim(),
        history: sanitizeHistory(history),
        source,
        understanding: understanding as DataUnderstanding | undefined,
        sessionId,
        onEvent: emit,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) await persistTurn(sessionId, question.trim(), answer);
    } catch (e) {
      if (controller.signal.aborted) return;
      console.error("[query] agent failed:", e);
      await emit({ type: "error", message: friendlyError(e) });
      await emit({ type: "done" });
    } finally {
      clearInterval(heartbeat);
    }
  });
});

function sanitizeHistory(history: unknown): HistoryTurn[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter((h): h is HistoryTurn => !!h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string")
    .map((h) => ({ role: h.role, content: h.content.slice(0, 4000), sql: typeof h.sql === "string" ? h.sql.slice(0, 4000) : undefined }));
}

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/api key|authentication|401/i.test(msg)) return "The AI service isn't configured correctly (check ANTHROPIC_API_KEY on the server).";
  if (/rate limit|429|overloaded|529/i.test(msg)) return "The AI service is busy right now. Please try again in a moment.";
  if (/ECONNREFUSED|ENOTFOUND|timeout|ETIMEDOUT/i.test(msg)) return "Couldn't reach your database. Check that it's online and try again.";
  return "Something went wrong while answering. Please try again.";
}
