import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageCreateParamsNonStreaming,
  BetaMessage,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";

/**
 * Single place that knows how Clairvoyance talks to Claude.
 *
 * - The model is configurable with CLAIRVOYANCE_MODEL (default: claude-sonnet-5-5).
 * - Server-side refusal fallbacks are on by default for models that support them;
 *   set ANTHROPIC_REFUSAL_FALLBACK=off to disable (e.g. on Bedrock/Vertex proxies).
 */
export const MODEL = process.env.CLAIRVOYANCE_MODEL ?? "claude-sonnet-5-5";

const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);
const useFallbacks = process.env.ANTHROPIC_REFUSAL_FALLBACK !== "off" && FALLBACK_MODELS.has(MODEL);

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // Lazily constructed so the server can boot (and tests can run) without credentials.
  if (!client) client = new Anthropic();
  return client;
}

type CreateParams = Omit<MessageCreateParamsNonStreaming, "model" | "betas" | "fallbacks"> & { model?: string };

export async function createMessage(params: CreateParams, options: { signal?: AbortSignal } = {}): Promise<BetaMessage> {
  return getClient().beta.messages.create(
    {
      model: MODEL,
      ...params,
      ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    },
    { signal: options.signal }
  );
}

/** Concatenate the text blocks of a response. */
export function responseText(message: BetaMessage): string {
  return message.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n")
    .trim();
}

/**
 * Ask Claude for a JSON object matching `schema` (structured outputs) and parse it.
 * Throws if the model refused or the output could not be parsed.
 */
export async function createJSON<T>(opts: {
  system?: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}): Promise<T> {
  const response = await createMessage({
    max_tokens: opts.maxTokens ?? 8000,
    ...(opts.system ? { system: opts.system } : {}),
    output_config: {
      effort: opts.effort ?? "low",
      format: { type: "json_schema", schema: opts.schema },
    },
    messages: [{ role: "user", content: opts.prompt }],
  });
  if (response.stop_reason === "refusal") throw new Error("The AI declined to analyse this data.");
  const text = responseText(response);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("The AI returned an unreadable response.");
  }
}
