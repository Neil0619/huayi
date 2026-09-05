import { analysisResultSchema, type AnalysisResult } from "@huayi/store-domain";

export interface QueryCacheStorage {
  read(): Promise<unknown>;
  write(value: unknown): Promise<void>;
}

export interface CachedQuery {
  readonly key: string;
  readonly expiresAt: number;
  readonly result: AnalysisResult;
}

export const QUERY_CACHE_TTL = 30 * 60_000;
export const QUERY_CACHE_MAX_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 30;

export function boundedQueryEntries(entries: readonly CachedQuery[], now: number): CachedQuery[] {
  const bounded = entries.filter((entry) => entry.expiresAt > now).slice(-MAX_ENTRIES);
  while (new TextEncoder().encode(JSON.stringify(bounded)).byteLength > QUERY_CACHE_MAX_BYTES) {
    bounded.shift();
  }
  return bounded;
}

export function readQueryEntries(value: unknown, now: number): CachedQuery[] {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) return [];
  const entries: CachedQuery[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    if (!("key" in item) || typeof item.key !== "string" || item.key.length !== 64) continue;
    if (!("expiresAt" in item) || typeof item.expiresAt !== "number") continue;
    if (item.expiresAt <= now || item.expiresAt > now + QUERY_CACHE_TTL) continue;
    if (!("result" in item)) continue;
    const parsed = analysisResultSchema.safeParse(item.result);
    if (parsed.success)
      entries.push({ key: item.key, expiresAt: item.expiresAt, result: parsed.data });
  }
  return boundedQueryEntries(entries, now);
}

export async function queryIdentity(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
