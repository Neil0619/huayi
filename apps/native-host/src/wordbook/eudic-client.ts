import type {
  AddWordRequest,
  CheckWordRequest,
  WordbookAddOutcome,
  WordbookPresence,
} from "@huayi/protocol";

import { EudicProviderError, eudicError } from "./eudic-errors.js";

export const EUDIC_WORD_ENDPOINT = "https://api.frdic.com/api/open/v1/studylist/word";
export const MAXIMUM_EUDIC_RESPONSE_BYTES = 64 * 1024;

export type EudicResponse = Pick<Response, "body" | "status">;

export interface EudicFetchInit {
  body?: string;
  credentials: "omit";
  headers: Readonly<Record<string, string>>;
  method: "GET" | "POST";
  redirect: "error";
  signal: AbortSignal;
}

export type EudicFetch = (url: string, init: EudicFetchInit) => Promise<EudicResponse>;

export interface EudicClientOptions {
  fetch?: EudicFetch;
}

function defaultFetch(url: string, init: EudicFetchInit): Promise<EudicResponse> {
  return fetch(url, init);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(response: EudicResponse, signal: AbortSignal): Promise<unknown> {
  if (response.body === null) {
    throw eudicError("INVALID_RESPONSE");
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      if (chunk.value === undefined) {
        throw eudicError("INVALID_RESPONSE");
      }
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAXIMUM_EUDIC_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw eudicError("INVALID_RESPONSE");
      }
      chunks.push(Buffer.from(chunk.value));
    }
  } catch (error) {
    if (error instanceof EudicProviderError) {
      throw error;
    }
    throw signal.aborted ? eudicError("CANCELLED", error) : eudicError("NETWORK_ERROR", error);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    throw eudicError("INVALID_RESPONSE", error);
  }
}

async function discardResponseBody(response: EudicResponse, signal: AbortSignal): Promise<void> {
  const body = response.body;
  if (body === null) {
    return;
  }
  if (signal.aborted) {
    throw eudicError("CANCELLED");
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const abort = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", abort);
      reject(eudicError("CANCELLED"));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    try {
      void body.cancel().then(finish, finish);
    } catch {
      finish();
    }
  });
}

function normalizeWordIdentity(value: string): string {
  return value.toLocaleLowerCase("en-US").replaceAll("’", "'");
}

function buildHeaders(authorization: string): Readonly<Record<string, string>> {
  return {
    Accept: "application/json",
    Authorization: authorization,
    "User-Agent": "Huayi/0.8.0",
  };
}

function buildQuery(request: Pick<CheckWordRequest, "language" | "word">): string {
  const query = new URL(EUDIC_WORD_ENDPOINT);
  query.searchParams.set("language", request.language);
  query.searchParams.set("word", request.word);
  return query.toString();
}

function buildGetInit(authorization: string, signal: AbortSignal): EudicFetchInit {
  return {
    credentials: "omit",
    headers: buildHeaders(authorization),
    method: "GET",
    redirect: "error",
    signal,
  };
}

function wordFromRecord(value: unknown): string | null {
  return isRecord(value) && typeof value.word === "string" ? value.word : null;
}

function queryWords(value: unknown): string[] {
  const directWord = wordFromRecord(value);
  if (directWord !== null) {
    return [directWord];
  }
  if (!isRecord(value) || !("data" in value)) {
    throw eudicError("INVALID_RESPONSE");
  }
  if (value.data === null) {
    return [];
  }
  if (Array.isArray(value.data)) {
    const words = value.data.map(wordFromRecord);
    if (words.some((word) => word === null)) {
      throw eudicError("INVALID_RESPONSE");
    }
    return words as string[];
  }
  const nestedWord = wordFromRecord(value.data);
  if (nestedWord === null) {
    throw eudicError("INVALID_RESPONSE");
  }
  return [nestedWord];
}

function throwForStatus(status: number): never {
  if (status >= 300 && status < 400) {
    throw eudicError("INVALID_RESPONSE");
  }
  if (status === 401) {
    throw eudicError("EUDIC_AUTH_FAILED");
  }
  if (status === 403 || status === 429) {
    throw eudicError("RATE_LIMITED");
  }
  if ([502, 503, 504].includes(status)) {
    throw eudicError("NETWORK_ERROR");
  }
  if (status === 400) {
    throw eudicError("INVALID_RESPONSE");
  }
  throw eudicError("INTERNAL_ERROR");
}

function diagnosticText(error: unknown): string {
  if (!(error instanceof Error)) {
    return "";
  }
  const cause = error.cause instanceof Error ? error.cause.message : "";
  return `${error.message} ${cause}`.toLowerCase();
}

export class EudicClient {
  private readonly fetch: EudicFetch;

  constructor(options: EudicClientOptions = {}) {
    this.fetch = options.fetch ?? defaultFetch;
  }

  async addWord(
    authorization: string,
    request: AddWordRequest,
    signal: AbortSignal,
  ): Promise<WordbookAddOutcome> {
    if ((await this.lookupWord(authorization, request, signal)) === "present") {
      return "already-exists";
    }

    const headers = buildHeaders(authorization);
    const addResponse = await this.request(EUDIC_WORD_ENDPOINT, {
      body: JSON.stringify({
        context_line: request.context,
        language: request.language,
        word: request.word,
      }),
      credentials: "omit",
      headers: { ...headers, "Content-Type": "application/json" },
      method: "POST",
      redirect: "error",
      signal,
    });
    if (addResponse.status !== 201) {
      await discardResponseBody(addResponse, signal);
      throwForStatus(addResponse.status);
    }
    const body = await readJson(addResponse, signal);
    if (!isRecord(body) || typeof body.message !== "string") {
      throw eudicError("INVALID_RESPONSE");
    }
    return "added";
  }

  checkWord(
    authorization: string,
    request: CheckWordRequest,
    signal: AbortSignal,
  ): Promise<WordbookPresence> {
    return this.lookupWord(authorization, request, signal);
  }

  private async lookupWord(
    authorization: string,
    request: Pick<CheckWordRequest, "language" | "word">,
    signal: AbortSignal,
  ): Promise<WordbookPresence> {
    const response = await this.request(buildQuery(request), buildGetInit(authorization, signal));
    if (response.status === 404) {
      await discardResponseBody(response, signal);
      return "absent";
    }
    if (response.status !== 200) {
      await discardResponseBody(response, signal);
      throwForStatus(response.status);
    }
    const words = queryWords(await readJson(response, signal));
    if (words.length === 0) {
      return "absent";
    }
    const requested = normalizeWordIdentity(request.word);
    if (!words.some((word) => normalizeWordIdentity(word) === requested)) {
      throw eudicError("INVALID_RESPONSE");
    }
    return "present";
  }

  private async request(url: string, init: EudicFetchInit): Promise<EudicResponse> {
    try {
      return await this.fetch(url, init);
    } catch (error) {
      if (error instanceof EudicProviderError) {
        throw error;
      }
      if (init.signal.aborted) {
        throw eudicError("CANCELLED", error);
      }
      throw /redirect/u.test(diagnosticText(error))
        ? eudicError("INVALID_RESPONSE", error)
        : eudicError("NETWORK_ERROR", error);
    }
  }
}
