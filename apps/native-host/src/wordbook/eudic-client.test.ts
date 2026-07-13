import { describe, expect, it, vi } from "vitest";

import type { AddWordRequest, CheckWordRequest } from "@huayi/protocol";

import {
  EudicClient,
  EUDIC_WORD_ENDPOINT,
  type EudicFetch,
  type EudicResponse,
} from "./eudic-client.js";
import { EudicProviderError } from "./eudic-errors.js";

const request: AddWordRequest = {
  context: "The investigation was in its early stages.",
  language: "en",
  requestId: "word-1",
  schemaVersion: 1,
  type: "add-word",
  word: "investigation",
};

function checkRequest(word = "investigation"): CheckWordRequest {
  return {
    language: "en",
    requestId: "check-word-1",
    schemaVersion: 1,
    type: "check-word",
    word,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function unusedBodyResponse(status: number): {
  cancel: ReturnType<typeof vi.fn>;
  response: EudicResponse;
} {
  const cancel = vi.fn(async () => undefined);
  const body = { cancel } as unknown as NonNullable<Response["body"]>;
  return { cancel, response: { body, status } };
}

describe("EudicClient", () => {
  it.each([
    { word: "Investigation" },
    { data: { word: "investigation" } },
    { data: [{ word: "other" }, { word: "investigation" }] },
  ])("reports present for documented lookup shape %#", async (queryBody) => {
    const fetch = vi.fn<EudicFetch>().mockResolvedValue(jsonResponse(queryBody));
    const client = new EudicClient({ fetch });
    const signal = new AbortController().signal;

    await expect(client.checkWord("NIS fake", checkRequest(), signal)).resolves.toBe("present");
    expect(fetch).toHaveBeenCalledWith(
      `${EUDIC_WORD_ENDPOINT}?language=en&word=investigation`,
      expect.objectContaining({ method: "GET", redirect: "error", signal }),
    );
    expect(fetch.mock.calls[0]?.[1]?.body).toBeUndefined();
  });

  it.each([{ data: null }, { data: [] }])("reports absent for empty data %#", async (queryBody) => {
    const client = new EudicClient({ fetch: async () => jsonResponse(queryBody) });

    await expect(
      client.checkWord("NIS fake", checkRequest(), new AbortController().signal),
    ).resolves.toBe("absent");
  });

  it("reports absent for 404 and cancels its unused body", async () => {
    const missing = unusedBodyResponse(404);
    const client = new EudicClient({ fetch: async () => missing.response });

    await expect(
      client.checkWord("NIS fake", checkRequest(), new AbortController().signal),
    ).resolves.toBe("absent");
    expect(missing.cancel).toHaveBeenCalledOnce();
  });

  it("fails closed when a lookup returns only mismatched words", async () => {
    const client = new EudicClient({
      fetch: async () => jsonResponse({ data: [{ word: "different" }] }),
    });

    await expect(
      client.checkWord("NIS fake", checkRequest(), new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it.each([
    [401, "EUDIC_AUTH_FAILED"],
    [403, "RATE_LIMITED"],
    [429, "RATE_LIMITED"],
    [502, "NETWORK_ERROR"],
  ] as const)("maps lookup HTTP %i to %s", async (status, code) => {
    const client = new EudicClient({ fetch: async () => jsonResponse({}, status) });

    await expect(
      client.checkWord("NIS fake", checkRequest(), new AbortController().signal),
    ).rejects.toMatchObject({ code });
  });

  it("maps a rejected lookup redirect to INVALID_RESPONSE", async () => {
    const client = new EudicClient({
      fetch: async () => {
        throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") });
      },
    });

    await expect(
      client.checkWord("NIS fake", checkRequest(), new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a lookup response larger than 64 KiB", async () => {
    const client = new EudicClient({
      fetch: async () =>
        jsonResponse({ data: [{ padding: "x".repeat(65 * 1024), word: "investigation" }] }),
    });

    await expect(
      client.checkWord("NIS fake", checkRequest(), new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("maps cancellation of an in-flight lookup to CANCELLED", async () => {
    const fetch = vi.fn<EudicFetch>(
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          const abort = () => reject(new TypeError("aborted"));
          init.signal.addEventListener("abort", abort, { once: true });
          if (init.signal.aborted) {
            abort();
          }
        }),
    );
    const client = new EudicClient({ fetch });
    const controller = new AbortController();

    const result = client.checkWord("NIS fake", checkRequest(), controller.signal);
    const assertion = expect(result).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort();
    await assertion;
  });

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
        headers: expect.objectContaining({
          Authorization: "NIS secret",
          "User-Agent": "Huayi/0.3.1",
        }),
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

  it("cancels unused 404 and error bodies before continuing or failing", async () => {
    const missing = unusedBodyResponse(404);
    let missingCalls = 0;
    const missingClient = new EudicClient({
      fetch: async () => {
        missingCalls += 1;
        if (missingCalls === 1) {
          return missing.response;
        }
        expect(missing.cancel).toHaveBeenCalledOnce();
        return jsonResponse({ message: "" }, 201);
      },
    });
    await expect(
      missingClient.addWord("NIS secret", request, new AbortController().signal),
    ).resolves.toBe("added");

    const queryError = unusedBodyResponse(401);
    const queryErrorClient = new EudicClient({ fetch: async () => queryError.response });
    await expect(
      queryErrorClient.addWord("NIS secret", request, new AbortController().signal),
    ).rejects.toMatchObject({ code: "EUDIC_AUTH_FAILED" });
    expect(queryError.cancel).toHaveBeenCalledOnce();

    const createError = unusedBodyResponse(503);
    let createCalls = 0;
    const createErrorClient = new EudicClient({
      fetch: async () => {
        createCalls += 1;
        return createCalls === 1 ? jsonResponse({ data: [] }) : createError.response;
      },
    });
    await expect(
      createErrorClient.addWord("NIS secret", request, new AbortController().signal),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(createError.cancel).toHaveBeenCalledOnce();
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
        return callCount === 1 ? jsonResponse({ data: [] }) : jsonResponse({ message: 42 }, 201);
      },
    });
    await expect(
      malformedCreate.addWord("NIS secret", request, new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("accepts a documented 201 response with an empty message", async () => {
    let callCount = 0;
    const client = new EudicClient({
      fetch: async () => {
        callCount += 1;
        return callCount === 1 ? jsonResponse({ data: [] }) : jsonResponse({ message: "" }, 201);
      },
    });

    await expect(client.addWord("NIS secret", request, new AbortController().signal)).resolves.toBe(
      "added",
    );
  });

  it.each([301, 302, 307, 308])(
    "treats a returned HTTP %i query redirect as invalid",
    async (status) => {
      const client = new EudicClient({ fetch: async () => jsonResponse({}, status) });

      await expect(
        client.addWord("NIS secret", request, new AbortController().signal),
      ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    },
  );

  it("treats a returned create redirect as invalid", async () => {
    let callCount = 0;
    const client = new EudicClient({
      fetch: async () => {
        callCount += 1;
        return callCount === 1 ? jsonResponse({ data: [] }) : jsonResponse({}, 302);
      },
    });

    await expect(
      client.addWord("NIS secret", request, new AbortController().signal),
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
