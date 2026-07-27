import { VoyageAIClient } from "voyageai";

let client: VoyageAIClient | null = null;

function getClient(): VoyageAIClient {
  if (!client) {
    const apiKey = process.env.VOYAGE_API_KEY;
    if (!apiKey) throw new Error("VOYAGE_API_KEY is not set");
    client = new VoyageAIClient({ apiKey });
  }
  return client;
}

export async function embedText(text: string): Promise<number[]> {
  const voyage = getClient();
  const result = await voyage.embed({
    input: [text],
    model: "voyage-3-lite",
  });
  return (result.data?.[0]?.embedding ?? []) as number[];
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const voyage = getClient();
  const result = await voyage.embed({
    input: texts,
    model: "voyage-3-lite",
  });
  return (result.data ?? []).map((d: any) => d.embedding as number[]);
}
