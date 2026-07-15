import {
  compatibleHttpFetchError,
  compatibleHttpHttpError,
  CompatibleHttpProviderError,
  compatibleHttpProviderError,
  type CompatibleHttpFetchAbortSource,
} from "./compatible-http-provider-errors.js";
import {
  parseCompatibleHttpResponseEvent,
  type CompatibleHttpResponseEvent,
} from "./compatible-http-responses-events.js";
import { buildResponsesRequestBody, type ResponsesRequest } from "./responses-request-body.js";
import { SseDecoder, type SseMessage } from "./sse-decoder.js";

const TIMEOUT_MS = 60_000;
const MAXIMUM_ERROR_BODY_BYTES = 64 * 1024;

export type CompatibleHttpFetchResponse = Pick<Response, "body" | "headers" | "status">;

export interface CompatibleHttpFetchInit {
  readonly body: string;
  readonly credentials: "omit";
  readonly headers: Readonly<Record<string, string>>;
  readonly method: "POST";
  readonly redirect: "error";
  readonly signal: AbortSignal;
}

export type CompatibleHttpFetch = (
  url: string,
  init: CompatibleHttpFetchInit,
) => Promise<CompatibleHttpFetchResponse>;

export interface CompatibleHttpResponsesClientOptions {
  readonly fetch?: CompatibleHttpFetch;
}

interface LinkedAbort {
  cleanup(): void;
  readonly signal: AbortSignal;
  source(): CompatibleHttpFetchAbortSource;
}

export function compatibleHttpResponsesClientLimitsForTest(): Readonly<{
  errorBodyBytes: number;
  timeoutMs: number;
}> {
  return { errorBodyBytes: MAXIMUM_ERROR_BODY_BYTES, timeoutMs: TIMEOUT_MS };
}

function defaultFetch(
  url: string,
  init: CompatibleHttpFetchInit,
): Promise<CompatibleHttpFetchResponse> {
  return fetch(url, init);
}

function linkedAbort(externalSignal: AbortSignal): LinkedAbort {
  const controller = new AbortController();
  let abortSource: CompatibleHttpFetchAbortSource = "none";
  const abort = (source: Exclude<CompatibleHttpFetchAbortSource, "none">): void => {
    if (abortSource !== "none") return;
    abortSource = source;
    controller.abort();
  };
  const onExternalAbort = (): void => abort("user");
  externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  if (externalSignal.aborted) onExternalAbort();
  const timeout = setTimeout(() => abort("timeout"), TIMEOUT_MS);
  let cleaned = false;
  return {
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(timeout);
      externalSignal.removeEventListener("abort", onExternalAbort);
    },
    signal: controller.signal,
    source: () => abortSource,
  };
}

function ignoreCancellation(cancel: () => Promise<void>, releaseLock?: () => void): void {
  try {
    void cancel().catch(() => undefined);
  } catch {
    // Stream cleanup is best effort.
  }
  try {
    releaseLock?.();
  } catch {
    // Some readers cannot be released while a read is pending.
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  ignoreCancellation(
    () => reader.cancel(),
    () => reader.releaseLock(),
  );
}

function cancelBody(body: ReadableStream<Uint8Array>): void {
  try {
    cancelReader(body.getReader());
  } catch {
    ignoreCancellation(() => body.cancel());
  }
}

async function consumeErrorBody(response: CompatibleHttpFetchResponse): Promise<void> {
  if (response.body === null) return;
  const reader = response.body.getReader();
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return;
      if (chunk.value === undefined) throw compatibleHttpProviderError("INVALID_RESPONSE");
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAXIMUM_ERROR_BODY_BYTES) {
        throw compatibleHttpProviderError("INVALID_RESPONSE");
      }
    }
  } finally {
    cancelReader(reader);
  }
}

function isEventStream(headers: Headers): boolean {
  return (
    headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "text/event-stream"
  );
}

function parseMessage(message: SseMessage): CompatibleHttpResponseEvent {
  try {
    return parseCompatibleHttpResponseEvent(message);
  } catch {
    throw compatibleHttpProviderError("INVALID_RESPONSE");
  }
}

function decodeMessages(action: () => SseMessage[]): CompatibleHttpResponseEvent[] {
  try {
    return action().map(parseMessage);
  } catch (error) {
    if (error instanceof CompatibleHttpProviderError) throw error;
    throw compatibleHttpProviderError("INVALID_RESPONSE");
  }
}

export class CompatibleHttpResponsesClient {
  readonly #fetch: CompatibleHttpFetch;

  constructor(options: CompatibleHttpResponsesClientOptions = {}) {
    this.#fetch = options.fetch ?? defaultFetch;
  }

  async *stream(
    request: ResponsesRequest,
    key: string,
    baseUrl: string,
    externalSignal: AbortSignal,
  ): AsyncIterable<CompatibleHttpResponseEvent> {
    const abort = linkedAbort(externalSignal);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      if (abort.signal.aborted) throw compatibleHttpFetchError(undefined, abort.source());
      const response = await this.#fetch(`${baseUrl}/responses`, {
        body: buildResponsesRequestBody(request),
        credentials: "omit",
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        redirect: "error",
        signal: abort.signal,
      });
      if (abort.signal.aborted) throw compatibleHttpFetchError(undefined, abort.source());
      if (response.status !== 200) {
        await consumeErrorBody(response);
        if (abort.signal.aborted) throw compatibleHttpFetchError(undefined, abort.source());
        throw compatibleHttpHttpError(response.status);
      }
      if (response.body === null) throw compatibleHttpProviderError("INVALID_RESPONSE");
      if (!isEventStream(response.headers)) {
        abort.cleanup();
        cancelBody(response.body);
        throw compatibleHttpProviderError("INVALID_RESPONSE");
      }

      reader = response.body.getReader();
      const decoder = new SseDecoder();
      while (true) {
        const chunk = await reader.read();
        if (abort.signal.aborted) throw compatibleHttpFetchError(undefined, abort.source());
        if (chunk.done) break;
        if (chunk.value === undefined) throw compatibleHttpProviderError("INVALID_RESPONSE");
        for (const event of decodeMessages(() => decoder.push(chunk.value))) yield event;
      }
      for (const event of decodeMessages(() => decoder.finish())) yield event;
    } catch (error) {
      if (error instanceof CompatibleHttpProviderError) throw error;
      throw compatibleHttpFetchError(error, abort.source());
    } finally {
      abort.cleanup();
      if (reader !== undefined) cancelReader(reader);
    }
  }
}
