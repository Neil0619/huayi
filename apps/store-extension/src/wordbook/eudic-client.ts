import {
  MAX_CONTEXT_SENTENCE_LENGTH,
  MAX_HEADWORD_LENGTH,
  normalizeHeadword,
} from "@huayi/store-domain";
import { z } from "zod/v3";

export const EUDIC_WORD_ENDPOINT = "https://api.frdic.com/api/open/v1/studylist/word";
export const EUDIC_WORDS_ENDPOINT = "https://api.frdic.com/api/open/v1/studylist/words";
export const EUDIC_LIST_PAGE_SIZE = 100;
export const DEFAULT_EUDIC_REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_LIST_RESPONSE_BYTES = 1024 * 1024;

export type EudicClientErrorCode =
  | "authentication-failed"
  | "credential-missing"
  | "data-corrupt"
  | "invalid-response"
  | "network-error"
  | "rate-limited"
  | "timeout";

export class EudicClientError extends Error {
  constructor(readonly code: EudicClientErrorCode) {
    super("Eudic request failed.");
    this.name = "EudicClientError";
  }
}

export interface EudicImportedWord {
  readonly addedAt: string;
  readonly contextLine?: string;
  readonly headword: string;
}

export interface EudicWordbookClient {
  addWord(
    headword: string,
    context: string | undefined,
    signal: AbortSignal,
  ): Promise<"already-present" | "created">;
  listWords(page: number, signal: AbortSignal): Promise<readonly EudicImportedWord[]>;
}

interface StoreEudicClientOptions {
  readonly authorization: () => Promise<string | null>;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

const listEntrySchema = z.strictObject({
  add_time: z.string().datetime({ offset: true }),
  context_line: z.string().trim().min(1).max(MAX_CONTEXT_SENTENCE_LENGTH).optional(),
  exp: z.string(),
  phon: z.string().optional(),
  star: z.number().int(),
  word: z.string().trim().min(1).max(MAX_HEADWORD_LENGTH),
});

const listResponseSchema = z.strictObject({
  data: z.array(listEntrySchema).max(EUDIC_LIST_PAGE_SIZE),
  message: z.string(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<unknown> {
  if (signal.aborted) throw new EudicClientError("timeout");
  if (response.body === null) throw new EudicClientError("invalid-response");
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (signal.aborted) throw new EudicClientError("timeout");
      if (chunk.done) break;
      if (chunk.value === undefined) throw new EudicClientError("invalid-response");
      total += chunk.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new EudicClientError("invalid-response");
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof EudicClientError) throw error;
    throw new EudicClientError(signal.aborted ? "timeout" : "invalid-response");
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

function throwForStatus(status: number): never {
  if (status === 401) throw new EudicClientError("authentication-failed");
  if (status === 403 || status === 429) throw new EudicClientError("rate-limited");
  if ([502, 503, 504].includes(status)) throw new EudicClientError("network-error");
  throw new EudicClientError("invalid-response");
}

async function rejectStatus(response: Response): Promise<never> {
  await response.body?.cancel().catch(() => undefined);
  return throwForStatus(response.status);
}

function queryWords(value: unknown): string[] {
  if (isRecord(value) && typeof value.word === "string") return [value.word];
  if (!isRecord(value) || !("data" in value)) throw new EudicClientError("invalid-response");
  if (value.data === null) return [];
  const values = Array.isArray(value.data) ? value.data : [value.data];
  const words = values.map((item) =>
    isRecord(item) && typeof item.word === "string" ? item.word : null,
  );
  if (words.some((word) => word === null)) throw new EudicClientError("invalid-response");
  return words as string[];
}

function parseRemoteHeadword(value: string): string {
  try {
    return normalizeHeadword(value);
  } catch {
    throw new EudicClientError("invalid-response");
  }
}

export class StoreEudicClient implements EudicWordbookClient {
  private readonly fetch: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: StoreEudicClientOptions) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_EUDIC_REQUEST_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > DEFAULT_EUDIC_REQUEST_TIMEOUT_MS
    ) {
      throw new RangeError("Eudic timeout must be from 1 through 10000 milliseconds.");
    }
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = timeoutMs;
  }

  async listWords(page: number, signal: AbortSignal): Promise<readonly EudicImportedWord[]> {
    if (!Number.isSafeInteger(page) || page < 0 || page > 50) {
      throw new RangeError("Eudic page must be an integer from 0 through 50.");
    }
    return this.withDeadline(signal, async (requestSignal) => {
      const url = new URL(EUDIC_WORDS_ENDPOINT);
      url.searchParams.set("language", "en");
      url.searchParams.set("category_id", "0");
      url.searchParams.set("page", String(page));
      url.searchParams.set("page_size", String(EUDIC_LIST_PAGE_SIZE));
      const response = await this.request(url.toString(), { method: "GET", signal: requestSignal });
      if (response.status !== 200) return rejectStatus(response);
      const parsed = listResponseSchema.safeParse(
        await readJson(response, MAX_LIST_RESPONSE_BYTES, requestSignal),
      );
      if (!parsed.success) throw new EudicClientError("invalid-response");
      return parsed.data.data.map((item) => ({
        addedAt: item.add_time,
        ...(item.context_line === undefined ? {} : { contextLine: item.context_line }),
        headword: parseRemoteHeadword(item.word),
      }));
    });
  }

  async lookupWord(headword: string, signal: AbortSignal): Promise<boolean> {
    return this.withDeadline(signal, async (requestSignal) => {
      const normalized = normalizeHeadword(headword);
      const url = new URL(EUDIC_WORD_ENDPOINT);
      url.searchParams.set("language", "en");
      url.searchParams.set("word", normalized);
      const response = await this.request(url.toString(), { method: "GET", signal: requestSignal });
      if (response.status === 404) {
        await response.body?.cancel().catch(() => undefined);
        return false;
      }
      if (response.status !== 200) return rejectStatus(response);
      const words = queryWords(await readJson(response, MAX_RESPONSE_BYTES, requestSignal));
      if (words.length === 0) return false;
      if (!words.some((word) => parseRemoteHeadword(word) === normalized)) {
        throw new EudicClientError("invalid-response");
      }
      return true;
    });
  }

  async addWord(
    headword: string,
    context: string | undefined,
    signal: AbortSignal,
  ): Promise<"already-present" | "created"> {
    const normalized = normalizeHeadword(headword);
    if (await this.lookupWord(normalized, signal)) return "already-present";
    return this.withDeadline(signal, async (requestSignal): Promise<"created"> => {
      const response = await this.request(EUDIC_WORD_ENDPOINT, {
        body: JSON.stringify({
          ...(context === undefined ? {} : { context_line: context }),
          language: "en",
          word: normalized,
        }),
        method: "POST",
        signal: requestSignal,
      });
      if (response.status !== 201) return rejectStatus(response);
      const body = await readJson(response, MAX_RESPONSE_BYTES, requestSignal);
      if (!isRecord(body) || typeof body.message !== "string") {
        throw new EudicClientError("invalid-response");
      }
      return "created";
    });
  }

  private async withDeadline<T>(
    callerSignal: AbortSignal,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (callerSignal.aborted) throw new EudicClientError("timeout");
    const controller = new AbortController();
    let rejectDeadline: (error: EudicClientError) => void = () => undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject;
    });
    const abort = () => {
      controller.abort();
      rejectDeadline(new EudicClientError("timeout"));
    };
    callerSignal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, this.timeoutMs);
    if (callerSignal.aborted) abort();
    try {
      return await Promise.race([operation(controller.signal), deadline]);
    } finally {
      clearTimeout(timeout);
      callerSignal.removeEventListener("abort", abort);
    }
  }

  private async request(
    url: string,
    request: {
      readonly body?: string;
      readonly method: "GET" | "POST";
      readonly signal: AbortSignal;
    },
  ): Promise<Response> {
    if (request.signal.aborted) throw new EudicClientError("timeout");
    let authorization: string | null;
    try {
      authorization = await this.options.authorization();
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error) {
        if (error.code === "invalid-persisted-data" || error.code === "authentication-failed") {
          throw new EudicClientError("data-corrupt");
        }
      }
      throw new EudicClientError("network-error");
    }
    if (request.signal.aborted) throw new EudicClientError("timeout");
    if (authorization === null || authorization.trim().length === 0) {
      throw new EudicClientError("credential-missing");
    }
    if (authorization.length > 4_096 || /[\r\n]/u.test(authorization)) {
      throw new EudicClientError("authentication-failed");
    }
    try {
      return await this.fetch(url, {
        ...(request.body === undefined ? {} : { body: request.body }),
        credentials: "omit",
        headers: {
          Accept: "application/json",
          Authorization: authorization,
          ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        method: request.method,
        redirect: "error",
        signal: request.signal,
      });
    } catch {
      if (request.signal.aborted) throw new EudicClientError("timeout");
      throw new EudicClientError("network-error");
    }
  }
}
