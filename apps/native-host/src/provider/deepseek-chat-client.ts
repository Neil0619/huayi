import {
  deepSeekFetchError,
  deepSeekHttpError,
  DeepSeekProviderError,
  deepSeekProviderError,
  type DeepSeekFetchAbortSource,
} from "./deepseek-provider-errors.js";
import { parseDeepSeekSseData, type DeepSeekChatEvent } from "./deepseek-chat-events.js";
import { buildDeepSeekRequestBody, type DeepSeekChatRequest } from "./deepseek-request-body.js";
import { DeepSeekSseDecoder } from "./deepseek-sse-decoder.js";

export const DEEPSEEK_CHAT_COMPLETIONS_ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_TIMEOUT_MS = 60_000;
const MAXIMUM_ERROR_BODY_BYTES = 64 * 1024;

export type DeepSeekFetchResponse = Pick<Response, "body" | "headers" | "status">;

export interface DeepSeekFetchInit {
  readonly body: string;
  readonly credentials: "omit";
  readonly headers: Readonly<Record<string, string>>;
  readonly method: "POST";
  readonly redirect: "error";
  readonly signal: AbortSignal;
}

export type DeepSeekFetch = (
  url: string,
  init: DeepSeekFetchInit,
) => Promise<DeepSeekFetchResponse>;

export interface DeepSeekChatClientOptions {
  readonly fetch?: DeepSeekFetch;
}

interface LinkedAbort {
  cleanup(): void;
  readonly signal: AbortSignal;
  source(): DeepSeekFetchAbortSource;
}

function defaultFetch(url: string, init: DeepSeekFetchInit): Promise<DeepSeekFetchResponse> {
  return fetch(url, init);
}

function linkedAbort(externalSignal: AbortSignal): LinkedAbort {
  const controller = new AbortController();
  let source: DeepSeekFetchAbortSource = "none";
  const abort = (next: Exclude<DeepSeekFetchAbortSource, "none">): void => {
    if (source !== "none") return;
    source = next;
    controller.abort();
  };
  const onExternalAbort = (): void => abort("user");
  externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  if (externalSignal.aborted) onExternalAbort();
  const timeout = setTimeout(() => abort("timeout"), DEEPSEEK_TIMEOUT_MS);
  let cleaned = false;
  return {
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(timeout);
      externalSignal.removeEventListener("abort", onExternalAbort);
    },
    signal: controller.signal,
    source: () => source,
  };
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // Stream cleanup is best effort.
  }
  try {
    reader.releaseLock();
  } catch {
    // Pending readers cannot always be released synchronously.
  }
}

function cancelBody(body: ReadableStream<Uint8Array> | null): void {
  if (body === null) return;
  try {
    void body.cancel().catch(() => undefined);
  } catch {
    // Response cleanup is best effort.
  }
}

async function consumeErrorBody(response: DeepSeekFetchResponse): Promise<void> {
  if (response.body === null) return;
  const reader = response.body.getReader();
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return;
      if (chunk.value === undefined) throw deepSeekProviderError("INVALID_RESPONSE");
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAXIMUM_ERROR_BODY_BYTES) {
        throw deepSeekProviderError("INVALID_RESPONSE");
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

export class DeepSeekChatClient {
  readonly #fetch: DeepSeekFetch;

  constructor(options: DeepSeekChatClientOptions = {}) {
    this.#fetch = options.fetch ?? defaultFetch;
  }

  async *stream(
    request: DeepSeekChatRequest,
    key: string,
    externalSignal: AbortSignal,
  ): AsyncIterable<DeepSeekChatEvent> {
    const abort = linkedAbort(externalSignal);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      if (abort.signal.aborted) throw deepSeekFetchError(undefined, abort.source());
      const response = await this.#fetch(DEEPSEEK_CHAT_COMPLETIONS_ENDPOINT, {
        body: buildDeepSeekRequestBody(request),
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
      if (abort.signal.aborted) throw deepSeekFetchError(undefined, abort.source());
      if (response.status !== 200) {
        await consumeErrorBody(response);
        if (abort.signal.aborted) throw deepSeekFetchError(undefined, abort.source());
        throw deepSeekHttpError(response.status);
      }
      if (response.body === null || !isEventStream(response.headers)) {
        cancelBody(response.body);
        throw deepSeekProviderError("INVALID_RESPONSE");
      }

      reader = response.body.getReader();
      const decoder = new DeepSeekSseDecoder();
      while (true) {
        const chunk = await reader.read();
        if (abort.signal.aborted) throw deepSeekFetchError(undefined, abort.source());
        if (chunk.done) break;
        if (chunk.value === undefined) throw deepSeekProviderError("INVALID_RESPONSE");
        for (const data of decoder.push(chunk.value)) yield parseDeepSeekSseData(data);
      }
      for (const data of decoder.finish()) yield parseDeepSeekSseData(data);
    } catch (error) {
      if (error instanceof DeepSeekProviderError) throw error;
      throw deepSeekFetchError(error, abort.source());
    } finally {
      abort.cleanup();
      if (reader !== undefined) cancelReader(reader);
    }
  }
}
