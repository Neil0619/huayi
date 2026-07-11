import { describe, expect, it, vi } from "vitest";

import type { AddWordRequest } from "@huayi/protocol";

import { EudicClient, EUDIC_WORD_ENDPOINT, type EudicFetch } from "./eudic-client.js";
import { EudicProviderError } from "./eudic-errors.js";

const request: AddWordRequest = {
  context: "The investigation was in its early stages.",
  language: "en",
  requestId: "word-1",
  schemaVersion: 1,
  type: "add-word",
  word: "investigation",
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("EudicClient", () => {
  it.each([
    { word: "Investigation" },
    { data: { word: "investigation" } },
    { data: [{ word: "other" }, { word: "investigation" }] },
  ])("returns already-exists for documented query shape %#", async (queryBody) => {
    const calls: string[] = [];
    const fetch: EudicFetch = async (url) => {
      calls.push(url);
      return jsonResponse(queryBody);
    };
    const client = new EudicClient({ fetch });

    await expect(client.addWord("NIS secret", request, new AbortController().signal)).resolves.toBe(
      "already-exists",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(`${EUDIC_WORD_ENDPOINT}?language=en&word=investigation`);
  });

  it("queries first and posts only the original word and context to the default group", async () => {
    const calls: { init: Parameters<EudicFetch>[1]; url: string }[] = [];
    const fetch: EudicFetch = async (url, init) => {
      calls.push({ init, url });
      return calls.length === 1
        ? jsonResponse({ data: [] })
        : jsonResponse({ message: "单词添加成功" }, 201);
    };
    const client = new EudicClient({ fetch });

    await expect(client.addWord("NIS secret", request, new AbortController().signal)).resolves.toBe(
      "added",
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      init: {
        credentials: "omit",
        headers: expect.objectContaining({ Authorization: "NIS secret" }),
        method: "GET",
        redirect: "error",
      },
      url: `${EUDIC_WORD_ENDPOINT}?language=en&word=investigation`,
    });
    expect(calls[1]?.url).toBe(EUDIC_WORD_ENDPOINT);
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({
      context_line: "The investigation was in its early stages.",
      language: "en",
      word: "investigation",
    });
  });

  it.each([
    [401, "EUDIC_AUTH_FAILED"],
    [403, "RATE_LIMITED"],
    [429, "RATE_LIMITED"],
    [400, "INVALID_RESPONSE"],
    [503, "NETWORK_ERROR"],
  ] as const)("maps HTTP %i to %s without exposing the body", async (status, code) => {
    const fetch: EudicFetch = async () => jsonResponse({ message: "secret diagnostic" }, status);
    const client = new EudicClient({ fetch });

    const error = await client
      .addWord("NIS secret", request, new AbortController().signal)
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(EudicProviderError);
    expect(error).toMatchObject({ code });
    expect(String(error)).not.toContain("secret diagnostic");
    expect(String(error)).not.toContain("NIS secret");
  });

  it("fails closed on mismatched, malformed, and oversized query responses", async () => {
    const responses = [
      jsonResponse({ word: "different" }),
      jsonResponse({ data: "unexpected" }),
      new Response(JSON.stringify({ data: "x".repeat(65 * 1024) }), { status: 200 }),
    ];

    for (const response of responses) {
      const client = new EudicClient({ fetch: async () => response });
      await expect(
        client.addWord("NIS secret", request, new AbortController().signal),
      ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });

  it("does not retry a rejected fetch", async () => {
    const fetch = vi.fn<EudicFetch>().mockRejectedValue(new TypeError("network failed"));
    const client = new EudicClient({ fetch });

    await expect(
      client.addWord("NIS secret", request, new AbortController().signal),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("treats a rejected redirect and malformed create response as invalid", async () => {
    const redirecting = new EudicClient({
      fetch: async () => {
        throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") });
      },
    });
    await expect(
      redirecting.addWord("NIS secret", request, new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

    let callCount = 0;
    const malformedCreate = new EudicClient({
      fetch: async () => {
        callCount += 1;
        return callCount === 1 ? jsonResponse({ data: [] }) : jsonResponse({ message: "" }, 201);
      },
    });
    await expect(
      malformedCreate.addWord("NIS secret", request, new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("maps a response-stream network failure without exposing diagnostics", async () => {
    const response = new Response("ignored", { status: 200 });
    Object.defineProperty(response, "body", {
      value: {
        getReader: () => ({
          cancel: async () => undefined,
          read: async () => {
            throw new TypeError("secret socket diagnostic");
          },
        }),
      },
    });
    const client = new EudicClient({
      fetch: async () => response,
    });

    const error = await client
      .addWord("NIS secret", request, new AbortController().signal)
      .catch((reason: unknown) => reason);
    expect(error).toMatchObject({ code: "NETWORK_ERROR" });
    expect(String(error)).not.toContain("secret socket diagnostic");
  });
});
