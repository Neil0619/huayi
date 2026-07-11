import { describe, expect, it, vi } from "vitest";

import type { AnalysisResult, AnalyzeRequest, HostEvent } from "@huayi/protocol";

import type { AnalysisProvider } from "../provider/analysis-provider.js";
import { NativeMessageDispatcher } from "./dispatcher.js";

const request: AnalyzeRequest = {
  action: "translate",
  context: "The investigation was in its early stages.",
  requestId: "request-1",
  schemaVersion: 1,
  selection: "investigation",
  selectionKind: "word",
  targetLanguage: "zh-CN",
  type: "analyze",
};

const validResult: AnalysisResult = {
  collocations: [
    { meaningZh: "刑事调查", text: "criminal investigation" },
    { meaningZh: "展开调查", text: "launch an investigation" },
  ],
  contextualMeaningZh: "调查",
  partOfSpeech: "noun",
  selectionKind: "word",
  similarTerms: [
    { meaningZh: "询问", partOfSpeech: "noun", text: "inquiry" },
    { meaningZh: "审查", partOfSpeech: "noun", text: "examination" },
    { meaningZh: "研究", partOfSpeech: "noun", text: "research" },
  ],
  sourceText: "investigation",
  type: "translate-lexical",
};

describe("NativeMessageDispatcher", () => {
  it("reports health and validates provider results", async () => {
    const events: HostEvent[] = [];
    const provider: AnalysisProvider = {
      analyze: async () => validResult,
    };
    const dispatcher = new NativeMessageDispatcher({
      healthCheck: async () => ({ codexVersion: "codex-cli 0.144.1" }),
      provider,
    });

    dispatcher.dispatch({ requestId: "health-1", schemaVersion: 1, type: "health" }, (event) =>
      events.push(event),
    );
    dispatcher.dispatch(request, (event) => events.push(event));

    await vi.waitFor(() => expect(events.some((event) => event.type === "result")).toBe(true));
    expect(events.map((event) => event.type)).toEqual([
      "progress",
      "progress",
      "health-result",
      "result",
    ]);
    dispatcher.dispose();
  });

  it("aborts an active analysis and emits one cancellation error", async () => {
    const events: HostEvent[] = [];
    let aborted = false;
    const provider: AnalysisProvider = {
      analyze: (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        }),
    };
    const dispatcher = new NativeMessageDispatcher({
      healthCheck: async () => ({ codexVersion: "codex-cli 0.144.1" }),
      provider,
    });

    dispatcher.dispatch(request, (event) => events.push(event));
    dispatcher.dispatch(
      {
        requestId: "cancel-1",
        schemaVersion: 1,
        targetRequestId: "request-1",
        type: "cancel",
      },
      (event) => events.push(event),
    );

    await vi.waitFor(() => expect(aborted).toBe(true));
    expect(events.filter((event) => event.type === "error")).toEqual([
      {
        error: { code: "CANCELLED", message: "请求已取消。", retryable: false },
        requestId: "request-1",
        schemaVersion: 1,
        type: "error",
      },
    ]);
    dispatcher.dispose();
  });

  it("maps an invalid provider result to INVALID_RESPONSE", async () => {
    const events: HostEvent[] = [];
    const provider: AnalysisProvider = {
      analyze: async () => ({ type: "unsafe" }) as unknown as AnalysisResult,
    };
    const dispatcher = new NativeMessageDispatcher({
      healthCheck: async () => ({ codexVersion: "codex-cli 0.144.1" }),
      provider,
    });

    dispatcher.dispatch(request, (event) => events.push(event));

    await vi.waitFor(() => expect(events.some((event) => event.type === "error")).toBe(true));
    expect(events.at(-1)).toMatchObject({
      error: { code: "INVALID_RESPONSE", retryable: true },
      type: "error",
    });
    dispatcher.dispose();
  });

  it("throws on an invalid inbound protocol object", () => {
    const dispatcher = new NativeMessageDispatcher({
      healthCheck: async () => ({ codexVersion: "codex-cli 0.144.1" }),
      provider: { analyze: async () => validResult },
    });

    expect(() =>
      dispatcher.dispatch({ schemaVersion: 1, type: "analyze" }, () => undefined),
    ).toThrow(/invalid host request/i);
    dispatcher.dispose();
  });
});
