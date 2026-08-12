import type { AnalysisCancellationSignal } from "@huayi/store-domain";

import { BrowserAnalysisError } from "./analysis-error.js";
import { BoundedSseDecoder, type SseMessage } from "./sse-decoder.js";

export interface ProviderStreamLimits {
  readonly errorBodyBytes: number;
  readonly eventBytes: number;
  readonly stallTimeoutMs: number;
  readonly timeoutMs: number;
  readonly totalBytes: number;
}

export const PROVIDER_STREAM_LIMITS: ProviderStreamLimits = {
  errorBodyBytes: 64 * 1_024,
  eventBytes: 64 * 1_024,
  stallTimeoutMs: 20_000,
  timeoutMs: 60_000,
  totalBytes: 2 * 1_024 * 1_024,
} as const;

export interface ProviderFetchInit {
  readonly body: string;
  readonly credentials: "omit";
  readonly headers: Readonly<Record<string, string>>;
  readonly method: "POST";
  readonly redirect: "error";
  readonly signal: AbortSignal;
}

export type ProviderFetch = (
  endpoint: string,
  init: ProviderFetchInit,
) => Promise<{
  readonly body: ReadableStream<Uint8Array<ArrayBufferLike>> | null;
  readonly headers: Headers;
  readonly status: number;
}>;

export interface ProviderStreamOptions {
  readonly body: string;
  readonly endpoint: string;
  readonly fetch: ProviderFetch;
  readonly key: string;
  readonly limits?: Partial<ProviderStreamLimits>;
  readonly signal: AnalysisCancellationSignal;
}

interface AbortState {
  cleanup(): void;
  readonly signal: AbortSignal;
  source(): "cancelled" | "none" | "timeout";
}

function linkedAbort(external: AnalysisCancellationSignal, timeoutMs: number): AbortState {
  const controller = new AbortController();
  let source: "cancelled" | "none" | "timeout" = "none";
  const abort = (next: "cancelled" | "timeout"): void => {
    if (source !== "none") return;
    source = next;
    controller.abort();
  };
  const onAbort = (): void => abort("cancelled");
  const eventSignal = external as AnalysisCancellationSignal & {
    addEventListener?: AbortSignal["addEventListener"];
    removeEventListener?: AbortSignal["removeEventListener"];
  };
  eventSignal.addEventListener?.("abort", onAbort, { once: true });
  const poll = setInterval(() => {
    if (external.aborted) onAbort();
  }, 25);
  const timeout = setTimeout(() => abort("timeout"), timeoutMs);
  if (external.aborted) onAbort();
  return {
    cleanup: () => {
      clearInterval(poll);
      clearTimeout(timeout);
      eventSignal.removeEventListener?.("abort", onAbort);
    },
    signal: controller.signal,
    source: () => source,
  };
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // Cleanup cannot replace the fixed public outcome.
  }
  try {
    reader.releaseLock();
  } catch {
    // A pending reader may still own its lock.
  }
}

function abortError(state: AbortState): BrowserAnalysisError {
  return new BrowserAnalysisError(state.source() === "timeout" ? "timeout" : "cancelled");
}

async function readWithStallTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  state: AbortState,
  stallTimeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const stalled = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new BrowserAnalysisError("timeout")), stallTimeoutMs);
  });
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortError(state));
    if (state.signal.aborted) onAbort();
    else state.signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([reader.read(), stalled, aborted]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined) state.signal.removeEventListener("abort", onAbort);
    if (state.signal.aborted) cancelReader(reader);
  }
}

function isEventStream(headers: Headers): boolean {
  return (
    headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "text/event-stream"
  );
}

export async function* readProviderSse(options: ProviderStreamOptions): AsyncIterable<SseMessage> {
  const limits = { ...PROVIDER_STREAM_LIMITS, ...options.limits };
  const abort = linkedAbort(options.signal, limits.timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (abort.signal.aborted) throw abortError(abort);
    let response: Awaited<ReturnType<ProviderFetch>>;
    try {
      response = await options.fetch(options.endpoint, {
        body: options.body,
        credentials: "omit",
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${options.key}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        redirect: "error",
        signal: abort.signal,
      });
    } catch {
      if (abort.signal.aborted) throw abortError(abort);
      throw new BrowserAnalysisError("network-error");
    }
    if (abort.signal.aborted) throw abortError(abort);
    if (response.status !== 200) {
      try {
        await response.body?.cancel();
      } catch {
        // Ignore cleanup failure.
      }
      throw new BrowserAnalysisError("provider-error");
    }
    if (response.body === null || !isEventStream(response.headers)) {
      try {
        await response.body?.cancel();
      } catch {
        // Ignore cleanup failure.
      }
      throw new BrowserAnalysisError("invalid-response");
    }
    reader = response.body.getReader();
    const decoder = new BoundedSseDecoder(limits);
    while (true) {
      const chunk = await readWithStallTimeout(reader, abort, limits.stallTimeoutMs);
      if (abort.signal.aborted) throw abortError(abort);
      if (chunk.done) break;
      if (chunk.value === undefined) throw new BrowserAnalysisError("invalid-response");
      for (const message of decoder.push(chunk.value)) yield message;
    }
    for (const message of decoder.finish()) yield message;
  } finally {
    abort.cleanup();
    if (reader !== undefined) cancelReader(reader);
  }
}
