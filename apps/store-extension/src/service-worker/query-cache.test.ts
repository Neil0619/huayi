import { describe, expect, it, vi } from "vitest";
import type {
  AnalysisEngine,
  AnalysisRequest,
  AnalysisResult,
  AnalysisUpdate,
} from "@huayi/store-domain";

import { createQueryCache } from "./query-cache.js";

const request: AnalysisRequest = {
  action: "explain",
  providerId: "deepseek",
  requestId: "first",
  selection: "The plan fell through.",
  selectionKind: "sentence",
  sentenceContext: null,
  targetLanguage: "zh-CN",
};
const result: AnalysisResult = {
  type: "explain-sentence",
  requestId: "first",
  sourceText: request.selection,
  selectionKind: "sentence",
  mainStructure: "主语和谓语",
  translationZh: "计划落空了。",
  keyExpressions: [{ text: "fell through", meaningZh: "落空" }],
  contextRole: "说明结果",
};

function setup() {
  let stored: unknown;
  let now = 1_000;
  const storage = {
    read: async () => stored,
    write: async (value: unknown) => {
      stored = structuredClone(value);
    },
  };
  return {
    storage,
    cache: createQueryCache({ storage, now: () => now }),
    advance: () => {
      now += 30 * 60_000 + 1;
    },
  };
}

describe("worker query cache", () => {
  it("explicit stop cancels subscribers and invalidation fences a late completion", async () => {
    const { cache, storage } = setup();
    let finish: ((value: AnalysisResult) => void) | undefined;
    const engine: AnalysisEngine = {
      analyze: vi.fn(
        async () =>
          new Promise<AnalysisResult>((resolve) => {
            finish = resolve;
          }),
      ),
    };
    const waiting = cache
      .analyze("a", engine, request, new AbortController().signal, () => undefined)
      .catch((error: unknown) => error);
    await vi.waitFor(() => expect(engine.analyze).toHaveBeenCalledOnce());
    cache.cancel("first");
    let acknowledged = false;
    void waiting.then(() => {
      acknowledged = true;
    });
    await Promise.resolve();
    expect(acknowledged).toBe(false);
    finish?.(result);
    expect(await waiting).toMatchObject({ code: "cancelled" });
    await cache.clear();
    await vi.waitFor(async () => expect(await storage.read()).toEqual([]));
  });

  it("evicts the oldest completion at thirty entries", async () => {
    const { cache, storage } = setup();
    const engine: AnalysisEngine = {
      analyze: vi.fn(async (input) => ({
        ...result,
        sourceText: input.selection,
        requestId: input.requestId,
      })),
    };
    for (let index = 0; index < 31; index++)
      await cache.analyze(
        "a",
        engine,
        { ...request, selection: `Sentence ${index}.` },
        new AbortController().signal,
        () => undefined,
      );
    await vi.waitFor(async () => expect(await storage.read()).toHaveLength(30));
    await cache.analyze(
      "a",
      engine,
      { ...request, selection: "Sentence 0." },
      new AbortController().signal,
      () => undefined,
    );
    expect(engine.analyze).toHaveBeenCalledTimes(32);
  });
  it("reuses a validated completion after popup close and worker restart with the caller's request id", async () => {
    const { cache, storage } = setup();
    const engine: AnalysisEngine = { analyze: vi.fn(async () => result) };
    await cache.analyze(
      "account-a:platform:1",
      engine,
      request,
      new AbortController().signal,
      () => undefined,
    );
    const restarted = createQueryCache({ storage, now: () => 2_000 });
    expect(
      await restarted.analyze(
        "account-a:platform:1",
        engine,
        { ...request, requestId: "second" },
        new AbortController().signal,
        () => undefined,
      ),
    ).toEqual({ ...result, requestId: "second" });
    expect(engine.analyze).toHaveBeenCalledOnce();
  });

  it("joins an in-flight request after detaching a page and replays bounded preview to the new subscriber", async () => {
    const { cache } = setup();
    let finish: (value: AnalysisResult) => void = () => undefined;
    const completion = new Promise<AnalysisResult>((resolve) => {
      finish = resolve;
    });
    const engine: AnalysisEngine = {
      analyze: vi.fn(async (_request, signal, update) => {
        update({
          requestId: "first",
          type: "delta",
          section: "main-structure",
          sequence: 0,
          text: "主语",
        });
        const value = await completion;
        expect(signal.aborted).toBe(false);
        return value;
      }),
    };
    const old = new AbortController();
    const first = cache
      .analyze("account-a", engine, request, old.signal, () => undefined)
      .catch((error: unknown) => error);
    await vi.waitFor(() => expect(engine.analyze).toHaveBeenCalledOnce());
    old.abort();
    const updates: AnalysisUpdate[] = [];
    const next = cache.analyze(
      "account-a",
      engine,
      { ...request, requestId: "second" },
      new AbortController().signal,
      (update) => updates.push(update),
    );
    await vi.waitFor(() => expect(updates).toHaveLength(1));
    finish(result);
    expect(await first).toMatchObject({ code: "cancelled" });
    expect(await next).toMatchObject({ requestId: "second" });
    expect(updates).toContainEqual({
      requestId: "second",
      type: "delta",
      section: "main-structure",
      sequence: 0,
      text: "主语",
    });
    expect(engine.analyze).toHaveBeenCalledOnce();
  });

  it("isolates accounts, context and actions, expires results, and never caches failures", async () => {
    const { cache, advance } = setup();
    const analyze = vi.fn(async (input: AnalysisRequest) => ({
      ...result,
      requestId: input.requestId,
    }));
    const run = (scope: string, input = request) =>
      cache.analyze(scope, { analyze }, input, new AbortController().signal, () => undefined);
    await run("a");
    await run("b");
    await run("b", { ...request, sentenceContext: "Another context." });
    advance();
    await run("a");
    expect(analyze).toHaveBeenCalledTimes(4);
    const failing = {
      analyze: vi.fn(async () => {
        throw new Error("failure");
      }),
    };
    for (let count = 0; count < 2; count++)
      await expect(
        cache.analyze("failure", failing, request, new AbortController().signal, () => undefined),
      ).rejects.toThrow("failure");
    expect(failing.analyze).toHaveBeenCalledTimes(2);
  });
});
