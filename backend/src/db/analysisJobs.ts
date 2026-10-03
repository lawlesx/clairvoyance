import { analyzeData, type DataUnderstanding } from "../agents/dataAnalyst";
import { getCachedUnderstanding, hashContent, persistSessionUnderstanding, setCachedUnderstanding } from "./understandingCache";
import { samplerFor, type DataSource } from "./dataSource";

/**
 * Runs the "get to know your data" analysis once per session, in the background.
 * An upload returns immediately; the session page asks for the result and simply
 * waits on the same in-flight promise instead of starting a second analysis.
 */
const jobs = new Map<string, Promise<DataUnderstanding>>();

/** A stable fingerprint of a schema: table + column names, sorted. */
export function schemaSignature(source: DataSource): string {
  return source.tables
    .map((t) => `${t.name}(${t.columns.map((c) => c.name).join(",")})`)
    .sort()
    .join(";");
}

export function startAnalysis(
  sessionId: string,
  source: DataSource,
  opts: { cacheKey?: string } = {}
): Promise<DataUnderstanding> {
  const existing = jobs.get(sessionId);
  if (existing) return existing;

  const job = (async () => {
    const cacheKey = opts.cacheKey ?? (await hashContent([schemaSignature(source)]));
    let understanding = await getCachedUnderstanding(cacheKey);
    if (!understanding) {
      understanding = await analyzeData(source.tables, { sampler: samplerFor(source) });
      await setCachedUnderstanding(cacheKey, understanding, schemaSignature(source).slice(0, 20_000));
    }
    await persistSessionUnderstanding(sessionId, understanding);
    return understanding;
  })();

  jobs.set(sessionId, job);
  // Forget the job once settled (success is persisted; failure can be retried).
  job.then(
    () => setTimeout(() => jobs.delete(sessionId), 60_000),
    () => jobs.delete(sessionId)
  );
  return job;
}
