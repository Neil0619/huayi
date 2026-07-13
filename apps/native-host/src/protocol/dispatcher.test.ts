import { describe, expect, it, vi } from "vitest";

import type { AnalysisResult, HostEvent } from "@huayi/protocol";

import type { AnalysisProvider } from "../provider/analysis-provider.js";
import { eventsFor, request, validResult } from "./dispatcher-test-helpers.js";
import { NativeMessageDispatcher } from "./dispatcher.js";

function createDispatcher(
  provider: AnalysisProvider = { analyze: async () => validResult },
): NativeMessageDispatcher {
  return new NativeMessageDispatcher({
    healthCheck: async () => ({ codexVersion: "codex-cli 0.144.1" }),
    provider,
  });
}

describe("NativeMessageDispatcher analysis routing", () => {
  it("reports host version 0.3.1", async () => {
    const events: HostEvent[] = [];
    const dispatcher = createDispatcher();

    dispatcher.dispatch({ requestId: "health-1", schemaVersion: 2, type: "health" }, (event) =>
      events.push(event),
    );

    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({ hostVersion: "0.3.1", type: "health-result" });
    dispatcher.dispose();
  });

  it("emits queued, running, sequenced deltas, then the validated result", async () => {
    const events: HostEvent[] = [];
    const provider: AnalysisProvider = {
      analyze: async (_currentRequest, _signal, onDelta) => {
        onDelta?.({ delta: "调", section: "translation" });
        onDelta?.({ delta: "查", section: "translation" });
        return validResult;
      },
    };
    const dispatcher = createDispatcher(provider);

    dispatcher.dispatch(request, (event) => events.push(event));

    await vi.waitFor(() => expect(events.some((event) => event.type === "result")).toBe(true));
    expect(events.map((event) => event.type)).toEqual([
      "progress",
      "progress",
      "analysis-delta",
      "analysis-delta",
      "result",
    ]);
    expect(events.filter((event) => event.type === "analysis-delta")).toEqual([
      expect.objectContaining({ sequence: 0, section: "translation" }),
      expect.objectContaining({ sequence: 1, section: "translation" }),
    ]);
    dispatcher.dispose();
  });

  it("ignores a late analysis delta and result after running cancellation", async () => {
    const events: HostEvent[] = [];
    let aborted = false;
    const provider: AnalysisProvider = {
      analyze: (_currentRequest, signal, onDelta) =>
        new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              onDelta?.({ delta: "late", section: "translation" });
              resolve(validResult);
            },
            { once: true },
          );
        }),
    };
    const dispatcher = createDispatcher(provider);

    dispatcher.dispatch(request, (event) => events.push(event));
    dispatcher.dispatch(
      {
        requestId: "cancel-1",
        schemaVersion: 2,
        targetRequestId: request.requestId,
        type: "cancel",
      },
      (event) => events.push(event),
    );

    await vi.waitFor(() => expect(aborted).toBe(true));
    expect(eventsFor(events, request.requestId).map((event) => event.type)).toEqual([
      "progress",
      "progress",
      "error",
    ]);
    dispatcher.dispose();
  });

  it("maps an invalid analysis result to INVALID_RESPONSE", async () => {
    const events: HostEvent[] = [];
    const provider: AnalysisProvider = {
      analyze: async () => ({ type: "unsafe" }) as unknown as AnalysisResult,
    };
    const dispatcher = createDispatcher(provider);

    dispatcher.dispatch(request, (event) => events.push(event));

    await vi.waitFor(() => expect(events.some((event) => event.type === "error")).toBe(true));
    expect(events.at(-1)).toMatchObject({
      error: { code: "INVALID_RESPONSE", retryable: true },
      type: "error",
    });
    dispatcher.dispose();
  });

  it("fails warmup closed until native host warmup is implemented", () => {
    const events: HostEvent[] = [];
    const analyze = vi.fn(async () => validResult);
    const dispatcher = createDispatcher({ analyze });

    dispatcher.dispatch({ requestId: "warmup-1", schemaVersion: 2, type: "warmup" }, (event) =>
      events.push(event),
    );

    expect(events).toEqual([
      expect.objectContaining({
        error: {
          code: "CODEX_CAPABILITY_MISSING",
          message: "当前 Codex CLI 缺少划译所需能力，请升级后重试。",
          retryable: false,
        },
        requestId: "warmup-1",
        type: "error",
      }),
    ]);
    expect(analyze).not.toHaveBeenCalled();
    dispatcher.dispose();
  });

  it("throws on an invalid inbound protocol object", () => {
    const dispatcher = createDispatcher();

    expect(() =>
      dispatcher.dispatch({ schemaVersion: 2, type: "analyze" }, () => undefined),
    ).toThrow(/invalid host request/i);
    dispatcher.dispose();
  });
});
