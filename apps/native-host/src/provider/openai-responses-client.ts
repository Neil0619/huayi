import { Buffer } from "node:buffer";

import {
  OpenAIProviderError,
  openAIFetchError,
  openAIHttpError,
  openAIProviderError,
  type OpenAIFetchAbortSource,
} from "./openai-provider-errors.js";
import { parseOpenAIResponseEvent, type OpenAIResponseEvent } from "./openai-responses-events.js";
import {
  buildResponsesRequestBody,
  type ResponsesModelConfiguration,
  type ResponsesRequest,
} from "./responses-request-body.js";
import { SseDecoder } from "./sse-decoder.js";

const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const OPENAI_RESPONSES_TIMEOUT_MS = 60_000;
const MAXIMUM_OPENAI_ERROR_BODY_BYTES = 64 * 1024;

export type OpenAIModelConfiguration = ResponsesModelConfiguration;
export type OpenAIResponsesRequest = ResponsesRequest;

export type OpenAIFetchResponse = Pick<Response, "body" | "headers" | "status">;

export interface OpenAIFetchInit {
  body: string;
  credentials: "omit";
  headers: Readonly<Record<string, string>>;
  method: "POST";
  redirect: "error";
  signal: AbortSignal;
}

export type OpenAIFetch = (url: string, init: OpenAIFetchInit) => Promise<OpenAIFetchResponse>;

export interface OpenAIResponsesClientOptions {
  fetch?: OpenAIFetch;
}

export function openAIResponsesClientLimitsForTest(): Readonly<{
  errorBodyBytes: number;
  timeoutMs: number;
}> {
  return {
    errorBodyBytes: MAXIMUM_OPENAI_ERROR_BODY_BYTES,
    timeoutMs: OPENAI_RESPONSES_TIMEOUT_MS,
  };
}

function defaultFetch(url: string, init: OpenAIFetchInit): Promise<OpenAIFetchResponse> {
  return fetch(url, init);
}

function requestInit(
  request: OpenAIResponsesRequest,
  key: string,
  signal: AbortSignal,
): OpenAIFetchInit {
  return {
    body: buildResponsesRequestBody(request),
    credentials: "omit",
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    method: "POST",
    redirect: "error",
    signal,
  };
}

interface LinkedAbort {
  cleanup(): void;
  signal: AbortSignal;
  source(): OpenAIFetchAbortSource;
}

function linkedAbort(externalSignal: AbortSignal): LinkedAbort {
  const controller = new AbortController();
  let abortSource: OpenAIFetchAbortSource = "none";
  let cleaned = false;
  const abort = (source: Exclude<OpenAIFetchAbortSource, "none">): void => {
    if (abortSource !== "none") return;
    abortSource = source;
    controller.abort();
  };
  const onExternalAbort = (): void => abort("user");
  externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  if (externalSignal.aborted) onExternalAbort();
  const timeout = setTimeout(() => abort("timeout"), OPENAI_RESPONSES_TIMEOUT_MS);

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
    // Stream cleanup is best effort and must not replace the intended result.
  }
  try {
    releaseLock?.();
  } catch {
    // A locked or pending reader cannot always be released synchronously.
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

async function readErrorBody(
  response: OpenAIFetchResponse,
  beforeCancel: () => void,
): Promise<unknown> {
  if (response.body === null) return undefined;
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value === undefined) throw openAIProviderError("INVALID_RESPONSE");
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAXIMUM_OPENAI_ERROR_BODY_BYTES) {
        throw openAIProviderError("INVALID_RESPONSE");
      }
      chunks.push(Buffer.from(chunk.value));
    }
  } finally {
    beforeCancel();
    cancelReader(reader);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function isEventStream(headers: Headers): boolean {
  return (
    headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "text/event-stream"
  );
}

export class OpenAIResponsesClient {
  readonly #fetch: OpenAIFetch;

  constructor(options: OpenAIResponsesClientOptions = {}) {
    this.#fetch = options.fetch ?? defaultFetch;
  }

  async *stream(
    request: OpenAIResponsesRequest,
    key: string,
    externalSignal: AbortSignal,
  ): AsyncIterable<OpenAIResponseEvent> {
    const abort = linkedAbort(externalSignal);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      if (abort.signal.aborted) throw openAIFetchError(new Error("aborted"), abort.source());
      const response = await this.#fetch(
        OPENAI_RESPONSES_ENDPOINT,
        requestInit(request, key, abort.signal),
      );
      if (abort.signal.aborted) throw openAIFetchError(new Error("aborted"), abort.source());
      if (response.status !== 200) {
        const errorBody = await readErrorBody(response, abort.cleanup);
        if (abort.signal.aborted) throw openAIFetchError(new Error("aborted"), abort.source());
        throw openAIHttpError(response.status, errorBody);
      }
      if (response.body === null) {
        throw openAIProviderError("INVALID_RESPONSE");
      }
      if (!isEventStream(response.headers)) {
        abort.cleanup();
        cancelBody(response.body);
        throw openAIProviderError("INVALID_RESPONSE");
      }

      reader = response.body.getReader();
      const decoder = new SseDecoder();
      while (true) {
        const chunk = await reader.read();
        if (abort.signal.aborted) throw openAIFetchError(new Error("aborted"), abort.source());
        if (chunk.done) break;
        if (chunk.value === undefined) throw openAIProviderError("INVALID_RESPONSE");
        for (const message of decoder.push(chunk.value)) {
          if (abort.signal.aborted) {
            throw openAIFetchError(new Error("aborted"), abort.source());
          }
          yield parseOpenAIResponseEvent(message);
        }
      }
      if (abort.signal.aborted) throw openAIFetchError(new Error("aborted"), abort.source());
      for (const message of decoder.finish()) {
        if (abort.signal.aborted) {
          throw openAIFetchError(new Error("aborted"), abort.source());
        }
        yield parseOpenAIResponseEvent(message);
      }
    } catch (error) {
      if (error instanceof OpenAIProviderError) throw error;
      throw openAIFetchError(error, abort.source());
    } finally {
      abort.cleanup();
      if (reader !== undefined) cancelReader(reader);
    }
  }
}
