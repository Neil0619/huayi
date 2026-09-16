import { describe, expect, it, vi } from "vitest";
import { MAX_CONTEXT_SENTENCE_LENGTH } from "@huayi/store-domain";

import {
  DEFAULT_EUDIC_REQUEST_TIMEOUT_MS,
  EUDIC_WORD_ENDPOINT,
  EUDIC_WORDS_ENDPOINT,
  StoreEudicClient,
} from "./eudic-client.js";

function response(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("Store Eudic client", () => {
  it("retains the browser global receiver when using the default fetch", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return response(200, {
        data: [{ add_time: "2026-09-15T00:00:00.000Z", exp: "", star: 0, word: "apple" }],
        message: "ok",
      });
    };
    try {
      const client = new StoreEudicClient({ authorization: async () => "Bearer offline-fixture" });
      await expect(client.listWords(0, new AbortController().signal)).resolves.toEqual([
        { addedAt: "2026-09-15T00:00:00.000Z", headword: "apple" },
      ]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it.each([undefined, "", " \t\n "])(
    "treats an optional empty context %j as absent without rejecting the page",
    async (context) => {
      const client = new StoreEudicClient({
        authorization: async () => "NIS test",
        fetch: async () =>
          response(200, {
            data: [
              {
                add_time: "2026-08-11T00:00:00.000Z",
                ...(context === undefined ? {} : { context_line: context }),
                exp: "",
                star: 0,
                word: "apple",
              },
            ],
            message: "ok",
          }),
      });
      await expect(client.listWords(0, new AbortController().signal)).resolves.toEqual([
        { addedAt: "2026-08-11T00:00:00.000Z", headword: "apple" },
      ]);
    },
  );

  it.each([null, 42, "x".repeat(MAX_CONTEXT_SENTENCE_LENGTH + 1)])(
    "still rejects invalid or overlong contexts without truncating them",
    async (context_line) => {
      const client = new StoreEudicClient({
        authorization: async () => "NIS test",
        fetch: async () =>
          response(200, {
            data: [
              {
                add_time: "2026-08-11T00:00:00.000Z",
                context_line,
                exp: "",
                star: 0,
                word: "apple",
              },
            ],
            message: "ok",
          }),
      });
      await expect(client.listWords(0, new AbortController().signal)).rejects.toMatchObject({
        code: "invalid-response",
      });
    },
  );

  it("uses only fixed frdic endpoints, strict bounded responses, and preserves context_line", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input);
      if (url.startsWith(EUDIC_WORDS_ENDPOINT)) {
        return response(200, {
          data: [
            {
              add_time: "2026-08-11T00:00:00.000Z",
              context_line: "A bounded context.",
              exp: "有界释义",
              phon: "",
              star: 1,
              word: "bounded",
            },
          ],
          message: "ok",
        });
      }
      return response(404, { message: "missing" });
    });
    const client = new StoreEudicClient({
      authorization: async () => "Bearer secret",
      fetch,
    });

    await expect(client.listWords(0, new AbortController().signal)).resolves.toEqual([
      {
        addedAt: "2026-08-11T00:00:00.000Z",
        contextLine: "A bounded context.",
        headword: "bounded",
      },
    ]);
    await client.lookupWord("bounded", new AbortController().signal);
    expect(
      fetch.mock.calls.every(([url]) => String(url).startsWith("https://api.frdic.com/")),
    ).toBe(true);
    expect(fetch.mock.calls.some(([url]) => String(url).startsWith(EUDIC_WORD_ENDPOINT))).toBe(
      true,
    );
    const headers = fetch.mock.calls[0]?.[1]?.headers;
    expect(headers).toEqual({ Accept: "application/json", Authorization: "Bearer secret" });
  });

  it("performs GET-before-POST and never overwrites an existing remote word", async () => {
    const existingFetch = vi.fn<typeof globalThis.fetch>(async () =>
      response(200, { data: { word: "Investigation" } }),
    );
    const existing = new StoreEudicClient({
      authorization: async () => "NIS test",
      fetch: existingFetch,
    });
    await expect(
      existing.addWord("investigation", "The investigation began.", new AbortController().signal),
    ).resolves.toBe("already-present");
    expect(existingFetch).toHaveBeenCalledOnce();

    const absentFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(404, { message: "missing" }))
      .mockResolvedValueOnce(response(201, { message: "created" }));
    const absent = new StoreEudicClient({
      authorization: async () => "NIS test",
      fetch: absentFetch,
    });
    await expect(
      absent.addWord("investigation", "The investigation began.", new AbortController().signal),
    ).resolves.toBe("created");
    expect(absentFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(absentFetch.mock.calls[1]?.[1]?.body))).toEqual({
      context_line: "The investigation began.",
      language: "en",
      word: "investigation",
    });
  });

  it("rejects invalid pages and maps authorization failures without leaking response text", async () => {
    const client = new StoreEudicClient({
      authorization: async () => "NIS test",
      fetch: async () => response(401, { secret: "must not escape" }),
    });
    await expect(client.listWords(51, new AbortController().signal)).rejects.toBeInstanceOf(
      RangeError,
    );
    await expect(client.listWords(0, new AbortController().signal)).rejects.toMatchObject({
      code: "authentication-failed",
    });
  });

  it("enforces the fixed internal deadline when the caller signal never aborts", async () => {
    expect(DEFAULT_EUDIC_REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(
      () =>
        new StoreEudicClient({
          authorization: async () => "NIS test",
          timeoutMs: DEFAULT_EUDIC_REQUEST_TIMEOUT_MS + 1,
        }),
    ).toThrow();

    let providerSignal: AbortSignal | undefined;
    const client = new StoreEudicClient({
      authorization: async () => "NIS test",
      fetch: async (_input, init) => {
        providerSignal = init?.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          providerSignal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        });
      },
      timeoutMs: 1,
    });

    const outcome = await Promise.race([
      client.listWords(0, new AbortController().signal).then(
        () => ({ code: "unexpected-success" }),
        (error: unknown) => error,
      ),
      new Promise((resolve) => setTimeout(() => resolve({ code: "still-pending" }), 25)),
    ]);

    expect(outcome).toMatchObject({ code: "timeout" });
    expect(providerSignal?.aborted).toBe(true);
  });
});
