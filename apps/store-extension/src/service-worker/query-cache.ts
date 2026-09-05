import {
  analysisResultSchema,
  analysisUpdateSchema,
  type AnalysisCancellationSignal,
  type AnalysisEngine,
  type AnalysisRequest,
  type AnalysisResult,
  type AnalysisUpdate,
  type AnalysisUpdateListener,
} from "@huayi/store-domain";
import { BrowserAnalysisError } from "../analysis/analysis-error.js";
import {
  boundedQueryEntries,
  queryIdentity,
  readQueryEntries,
  QUERY_CACHE_TTL,
  QUERY_CACHE_MAX_BYTES,
  type CachedQuery,
  type QueryCacheStorage,
} from "./query-cache-storage.js";

interface Subscriber {
  readonly requestId: string;
  readonly update: AnalysisUpdateListener;
  readonly resolve: (result: AnalysisResult) => void;
  readonly reject: (error: unknown) => void;
  readonly cleanup: () => void;
}
interface RunningQuery {
  readonly controller: AbortController;
  readonly subscribers: Set<Subscriber>;
  readonly updates: AnalysisUpdate[];
  bytes: number;
  sequence: number;
}
export interface QueryCache {
  analyze(
    scope: string,
    engine: AnalysisEngine,
    request: AnalysisRequest,
    signal: AnalysisCancellationSignal,
    onUpdate: AnalysisUpdateListener,
  ): Promise<AnalysisResult>;
  cancel(requestId: string): void;
  clear(): Promise<void>;
}

/** Owns generation independently of the lifetime of any content-script port. */
export function createQueryCache(options: {
  readonly storage: QueryCacheStorage;
  readonly now?: () => number;
}): QueryCache {
  const now = options.now ?? Date.now;
  const running = new Map<string, RunningQuery>();
  let entries: CachedQuery[] = [];
  let epoch = 0;
  let writes = Promise.resolve();
  const initialized = options.storage
    .read()
    .then((value) => {
      if (epoch === 0) entries = readQueryEntries(value, now());
    })
    .catch(() => undefined);

  function persist(): Promise<void> {
    // Serialize snapshots so a slow write cannot resurrect an invalidated account.
    const snapshot = [...entries];
    writes = writes.then(() => options.storage.write(snapshot)).catch(() => undefined);
    return writes;
  }
  function finish(job: RunningQuery, result: AnalysisResult | null, error?: unknown): void {
    for (const subscriber of job.subscribers) {
      subscriber.cleanup();
      if (result) subscriber.resolve({ ...result, requestId: subscriber.requestId });
      else subscriber.reject(error);
    }
    job.subscribers.clear();
  }
  function update(job: RunningQuery, value: AnalysisUpdate): void {
    if (job.controller.signal.aborted) return;
    const parsed = analysisUpdateSchema.parse(value);
    if (parsed.type !== "progress") {
      if (parsed.sequence <= job.sequence) throw new BrowserAnalysisError("invalid-response");
      job.sequence = parsed.sequence;
    }
    job.bytes += new TextEncoder().encode(JSON.stringify(parsed)).byteLength;
    if (job.bytes > QUERY_CACHE_MAX_BYTES) throw new BrowserAnalysisError("invalid-response");
    job.updates.push(parsed);
    for (const subscriber of job.subscribers) {
      try {
        subscriber.update({ ...parsed, requestId: subscriber.requestId });
      } catch {
        subscriber.cleanup();
        job.subscribers.delete(subscriber);
        subscriber.reject(new BrowserAnalysisError("cancelled"));
      }
    }
  }
  async function generate(
    key: string,
    job: RunningQuery,
    engine: AnalysisEngine,
    request: AnalysisRequest,
  ): Promise<void> {
    const generation = epoch;
    try {
      const result = analysisResultSchema.parse(
        await engine.analyze(request, job.controller.signal, (value) => {
          if (value.requestId !== request.requestId)
            throw new BrowserAnalysisError("invalid-response");
          update(job, value);
        }),
      );
      if (job.controller.signal.aborted || epoch !== generation)
        throw new BrowserAnalysisError("cancelled");
      if (
        result.requestId !== request.requestId ||
        result.sourceText !== request.selection ||
        result.selectionKind !== request.selectionKind ||
        !result.type.startsWith(`${request.action}-`)
      ) {
        throw new BrowserAnalysisError("invalid-response");
      }
      entries = boundedQueryEntries(
        [
          ...entries.filter((entry) => entry.key !== key),
          {
            key,
            expiresAt: now() + QUERY_CACHE_TTL,
            result,
          },
        ],
        now(),
      );
      // Paint the completed result without waiting on disk; shutdown recovery uses session storage.
      void persist();
      finish(job, result);
    } catch (error) {
      finish(job, null, error);
    } finally {
      if (running.get(key) === job) running.delete(key);
    }
  }
  return {
    async analyze(scope, engine, request, signal, onUpdate) {
      const generation = epoch;
      const { requestId, ...input } = request;
      const [key] = await Promise.all([queryIdentity({ version: 1, scope, input }), initialized]);
      if (signal.aborted || generation !== epoch) throw new BrowserAnalysisError("cancelled");
      const cached = entries.find((entry) => entry.key === key && entry.expiresAt > now());
      if (cached) {
        entries = [...entries.filter((entry) => entry !== cached), cached];
        void persist();
        return { ...cached.result, requestId };
      }
      let job = running.get(key);
      const start = job === undefined;
      job ??= {
        controller: new AbortController(),
        subscribers: new Set(),
        updates: [],
        bytes: 0,
        sequence: -1,
      };
      running.set(key, job);
      const current = job;
      return new Promise<AnalysisResult>((resolve, reject) => {
        const observable = signal as AnalysisCancellationSignal &
          Partial<Pick<AbortSignal, "addEventListener" | "removeEventListener">>;
        const detach = (): void => {
          current.subscribers.delete(subscriber);
          subscriber.cleanup();
          reject(new BrowserAnalysisError("cancelled"));
        };
        const subscriber: Subscriber = {
          requestId,
          update: onUpdate,
          resolve,
          reject,
          cleanup: () => observable.removeEventListener?.("abort", detach),
        };
        current.subscribers.add(subscriber);
        observable.addEventListener?.("abort", detach, { once: true });
        try {
          for (const value of current.updates) onUpdate({ ...value, requestId });
        } catch {
          detach();
        }
        if (start) void generate(key, current, engine, request);
      });
    },
    cancel(requestId) {
      for (const job of running.values()) {
        if (!Array.from(job.subscribers).some((subscriber) => subscriber.requestId === requestId))
          continue;
        job.controller.abort();
        // Keep subscribers attached until the provider/task acknowledges the stop.
      }
    },
    async clear() {
      epoch += 1;
      entries = [];
      for (const job of running.values()) {
        job.controller.abort();
        finish(job, null, new BrowserAnalysisError("cancelled"));
      }
      running.clear();
      await persist();
    },
  };
}
