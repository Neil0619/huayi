import { describe, expect, it, vi } from "vitest";

import type { AnalysisResult, HostEvent } from "@huayi/protocol";

import type { AnalysisProvider } from "../provider/analysis-provider.js";
import type { AnalysisStreamUpdate } from "../provider/analysis-provider.js";
import { eventsFor, request, validResult, warmupRequest } from "./dispatcher-test-helpers.js";
import { NativeMessageDispatcher } from "./dispatcher.js";

function createDispatcher(
  provider: AnalysisProvider = {
    analyze: async () => validResult,
    warmup: async () => undefined,
  },
): NativeMessageDispatcher {
  return new NativeMessageDispatcher({
    healthCheck: async () => ({
      codexVersion: "codex-cli 0.144.1",
      model: "gpt-5.4-mini",
      provider: "codex",
    }),
    provider,
  });
}

describe("NativeMessageDispatcher analysis routing", () => {
  it("reports host version 0.10.0 and the active Codex health fields", async () => {
    const events: HostEvent[] = [];
    const dispatcher = createDispatcher();

    dispatcher.dispatch({ requestId: "health-1", schemaVersion: 5, type: "health" }, (event) =>
      events.push(event),
    );

    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({
      codexVersion: "codex-cli 0.144.1",
      hostVersion: "0.10.0",
      model: "gpt-5.4-mini",
      provider: "codex",
      type: "health-result",
    });
    dispatcher.dispose();
  });

  it("reports API health without a Codex version", async () => {
    const events: HostEvent[] = [];
    const dispatcher = new NativeMessageDispatcher({
      healthCheck: async () => ({
        codexVersion: null,
        model: "gpt-5.6-luna",
        provider: "openai-responses",
      }),
      provider: {
        analyze: async () => validResult,
        warmup: async () => undefined,
      },
    });

    dispatcher.dispatch({ requestId: "health-api", schemaVersion: 5, type: "health" }, (event) =>
      events.push(event),
    );

    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toEqual({
      codexVersion: null,
      hostVersion: "0.10.0",
      model: "gpt-5.6-luna",
      provider: "openai-responses",
      ready: true,
      requestId: "health-api",
      schemaVersion: 5,
      type: "health-result",
    });
    dispatcher.dispose();
  });

  it("emits deltas and structured sections with one shared sequence", async () => {
    const events: HostEvent[] = [];
    const provider: AnalysisProvider = {
      warmup: async () => undefined,
      analyze: async (_currentRequest, _signal, onDelta) => {
        onDelta?.({ delta: "调", section: "translation", type: "analysis-delta" });
        onDelta?.({ section: "part-of-speech", type: "analysis-section", value: "noun" });
        onDelta?.({ delta: "查", section: "translation", type: "analysis-delta" });
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
      "analysis-section",
      "analysis-delta",
      "result",
    ]);
    expect(
      events.filter(
        (event) => event.type === "analysis-delta" || event.type === "analysis-section",
      ),
    ).toEqual([
      expect.objectContaining({ sequence: 0, section: "translation", type: "analysis-delta" }),
      expect.objectContaining({
        sequence: 1,
        section: "part-of-speech",
        type: "analysis-section",
        value: "noun",
      }),
      expect.objectContaining({ sequence: 2, section: "translation", type: "analysis-delta" }),
    ]);
    dispatcher.dispose();
  });

  it("ignores a late analysis delta and result after running cancellation", async () => {
    const events: HostEvent[] = [];
    let aborted = false;
    const provider: AnalysisProvider = {
      warmup: async () => undefined,
      analyze: (_currentRequest, signal, onDelta) =>
        new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              onDelta?.({ delta: "late", section: "translation", type: "analysis-delta" });
              onDelta?.({
                section: "part-of-speech",
                type: "analysis-section",
                value: "noun",
              });
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
        schemaVersion: 5,
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
      warmup: async () => undefined,
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

  it("validates each progressive Host event before transport", async () => {
    const events: HostEvent[] = [];
    const provider: AnalysisProvider = {
      warmup: async () => undefined,
      analyze: async (_currentRequest, _signal, onUpdate) => {
        onUpdate?.({
          section: "collocations",
          type: "analysis-section",
          value: [],
        } as AnalysisStreamUpdate);
        return validResult;
      },
    };
    const dispatcher = createDispatcher(provider);

    dispatcher.dispatch(request, (event) => events.push(event));

    await vi.waitFor(() => expect(events.some((event) => event.type === "error")).toBe(true));
    expect(events.map((event) => event.type)).toEqual(["progress", "progress", "error"]);
    expect(events.at(-1)).toMatchObject({ error: { code: "INTERNAL_ERROR" }, type: "error" });
    dispatcher.dispose();
  });

  it("queues warmup and emits only one validated warmup-ready terminal event", async () => {
    const events: HostEvent[] = [];
    const analyze = vi.fn(async () => validResult);
    const warmup = vi.fn((signal: AbortSignal) => {
      void signal;
      return Promise.resolve();
    });
    const dispatcher = createDispatcher({ analyze, warmup });

    dispatcher.dispatch(warmupRequest, (event) => events.push(event));

    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events).toEqual([{ ...warmupRequest, type: "warmup-ready" }]);
    expect(warmup).toHaveBeenCalledTimes(1);
    expect(warmup.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
    expect(analyze).not.toHaveBeenCalled();
    dispatcher.dispose();
  });

  it("cancels a running warmup through the shared request queue with one error", async () => {
    const events: HostEvent[] = [];
    let aborted = false;
    const provider: AnalysisProvider = {
      analyze: async () => validResult,
      warmup: (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }),
    };
    const dispatcher = createDispatcher(provider);

    dispatcher.dispatch(warmupRequest, (event) => events.push(event));
    dispatcher.dispatch(
      {
        requestId: "cancel-warmup",
        schemaVersion: 5,
        targetRequestId: warmupRequest.requestId,
        type: "cancel",
      },
      (event) => events.push(event),
    );

    await vi.waitFor(() => expect(aborted).toBe(true));
    expect(events).toEqual([
      expect.objectContaining({
        error: expect.objectContaining({ code: "CANCELLED", retryable: false }),
        requestId: warmupRequest.requestId,
        type: "error",
      }),
    ]);
    dispatcher.dispose();
  });

  it("does not emit a second terminal when ready handling reentrantly cancels warmup", async () => {
    const events: HostEvent[] = [];
    const dispatcher = createDispatcher();

    dispatcher.dispatch(warmupRequest, (event) => {
      events.push(event);
      if (event.type === "warmup-ready") {
        dispatcher.dispatch(
          {
            requestId: "cancel-after-ready",
            schemaVersion: 5,
            targetRequestId: warmupRequest.requestId,
            type: "cancel",
          },
          (cancelEvent) => events.push(cancelEvent),
        );
      }
    });

    await vi.waitFor(() =>
      expect(events.some((event) => event.type === "warmup-ready")).toBe(true),
    );
    expect(events).toEqual([{ ...warmupRequest, type: "warmup-ready" }]);
    dispatcher.dispose();
  });

  it("throws on an invalid inbound protocol object", () => {
    const dispatcher = createDispatcher();

    expect(() =>
      dispatcher.dispatch({ schemaVersion: 5, type: "analyze" }, () => undefined),
    ).toThrow(/invalid host request/i);
    dispatcher.dispose();
  });
});
