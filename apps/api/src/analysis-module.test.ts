import { contractFixtures } from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";

import { createAnalysisModule } from "./analysis-module.js";
import { createInMemoryAnalysisRequestLifecycle } from "./analysis-request-lifecycle.js";
import {
  createInMemoryAnalysisCommitter,
  createInMemoryAnalysisRepository,
} from "./analysis-repository.js";
import { FakeAnalysisModel, FakeAnalysisQuota } from "./test-support/analysis-fakes.js";
import { createFakeStudyCaptureReader } from "./test-support/analysis-study-capture-fake.js";
import { MutableClock } from "./test-support/security-fakes.js";
import { CloudFault } from "./cloud-fault.js";
import { createDeepSeekPriceSchedule } from "./deepseek-price-schedule.js";

function fixture(
  content: unknown = {
    candidates: contractFixtures.analysis.candidates,
    modelMetadata: contractFixtures.analysis.modelMetadata,
    result: contractFixtures.analysis.result,
  },
  withDispatchPricing = false,
  failCommit = false,
) {
  const model = new FakeAnalysisModel(content);
  const dispatchModel = new FakeAnalysisModel(content);
  const quota = new FakeAnalysisQuota();
  const repository = createInMemoryAnalysisRepository();
  const clock = new MutableClock("2026-08-12T10:00:00.000Z");
  const lifecycle = createInMemoryAnalysisRequestLifecycle({ now: () => clock.now() });
  const markDispatched = vi.fn(async () => undefined);
  const pricing = createDeepSeekPriceSchedule({
    legacy: "10000000-0000-4000-8000-000000000001",
    offPeak: "10000000-0000-4000-8000-000000000002",
    peak: "10000000-0000-4000-8000-000000000003",
  });
  const requestLifecycle = withDispatchPricing ? { ...lifecycle, markDispatched } : lifecycle;
  const baseCommitter = createInMemoryAnalysisCommitter(repository, quota, lifecycle);
  const module = createAnalysisModule({
    clock,
    committer: failCommit
      ? {
          ...baseCommitter,
          async complete() {
            throw new Error("database commit failed");
          },
        }
      : baseCommitter,
    cursorKey: new Uint8Array(32).fill(7),
    ids: (() => {
      let value = 0;
      return () => `generated-${++value}`;
    })(),
    model,
    ...(withDispatchPricing ? { modelForPricing: () => dispatchModel, pricing } : {}),
    quota,
    requestLifecycle,
    repository,
    studyCaptures: createFakeStudyCaptureReader(),
  });
  return {
    clock,
    dispatchModel,
    lifecycle,
    markDispatched,
    model,
    module,
    pricing,
    quota,
    repository,
  };
}

describe("analysis module", () => {
  it("pins dispatch pricing before selecting the model and settlement version", async () => {
    const { dispatchModel, markDispatched, model, module, pricing } = fixture(undefined, true);

    for await (const event of module.startPlatformAnalysis({
      idempotencyKey: "dispatch-price",
      input: contractFixtures.startAnalysisRequest,
      userId: "user-a",
    }))
      void event;

    expect(markDispatched).toHaveBeenCalledWith(
      expect.objectContaining({ pricing: pricing.at(new Date("2026-08-12T10:00:00.000Z")) }),
    );
    expect(model.requests).toHaveLength(0);
    expect(dispatchModel.requests).toHaveLength(1);
  });

  it("reserves before the fake model, emits ordered events, and persists only final output", async () => {
    const { model, module, quota, repository } = fixture();
    const events = [];
    for await (const event of module.startPlatformAnalysis({
      idempotencyKey: "key-1",
      input: contractFixtures.startAnalysisRequest,
      userId: "user-a",
    })) {
      events.push(event);
      if (event.type === "analysis.preview")
        expect(await repository.list("user-a", { archived: false, limit: 20 })).toEqual({
          hasMore: false,
          items: [],
        });
    }
    expect(events.map((event) => event.type)).toEqual([
      "analysis.started",
      "analysis.preview",
      "analysis.completed",
    ]);
    expect(quota.operations).toEqual(["reserve:generated-1", "settle:generated-1:succeeded"]);
    expect(model.requests[0]?.sentences).toEqual([
      { analysisUnitId: "u1", ordinal: 0, sourceText: "To be frank, this works." },
    ]);
    expect(await module.getRequestStatus("user-a", "generated-1")).toMatchObject({
      state: "completed",
    });
    expect((await repository.list("user-a", { archived: false, limit: 20 })).items).toHaveLength(1);
  });

  it("replaces private model candidate aliases with server-owned ids before persistence", async () => {
    const { module } = fixture();
    const events = [];
    for await (const event of module.startPlatformAnalysis({
      idempotencyKey: "server-candidate-ids",
      input: contractFixtures.startAnalysisRequest,
      userId: "user-a",
    })) {
      events.push(event);
    }

    const completed = events.at(-1);
    expect(completed).toMatchObject({
      analysis: {
        candidates: [expect.objectContaining({ id: "generated-4" })],
        result: { sentences: [expect.objectContaining({ candidateIds: ["generated-4"] })] },
      },
      type: "analysis.completed",
    });
  });

  it("preserves generated billing facts when persistence fails after model completion", async () => {
    const { module, quota } = fixture(undefined, false, true);
    const events = [];
    for await (const event of module.startPlatformAnalysis({
      idempotencyKey: "post-model-commit-failure",
      input: contractFixtures.startAnalysisRequest,
      userId: "user-a",
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({ type: "analysis.failed" });
    expect(quota.settlements.at(-1)).toMatchObject({
      actualCostMicroUsd: 20_000,
      billedCalls: [
        {
          costMicroUsd: 20_000,
          usage: { cachedInputTokens: 10, inputTokens: 100, outputTokens: 200 },
        },
      ],
      outcome: "failed",
      usage: { cachedInputTokens: 10, inputTokens: 100, outputTokens: 200 },
    });
  });

  it("settles failures without partial persistence or private errors", async () => {
    const { model, module, quota, repository } = fixture();
    model.failure = new Error("private provider response");
    const events = [];
    for await (const event of module.startPlatformAnalysis({
      idempotencyKey: "key-1",
      input: contractFixtures.startAnalysisRequest,
      userId: "user-a",
    }))
      events.push(event);
    expect(events.at(-1)).toMatchObject({ type: "analysis.failed" });
    expect(quota.operations.at(-1)).toBe("settle:generated-1:failed");
    expect(await repository.list("user-a", { archived: false, limit: 20 })).toEqual({
      hasMore: false,
      items: [],
    });
    expect(JSON.stringify(events)).not.toContain("private provider response");
  });

  it("settles a model failure with validated actual usage and cost", async () => {
    const { model, module, quota } = fixture();
    model.failure = Object.assign(new Error("invalid structured output"), {
      usage: { cachedInputTokens: 20, inputTokens: 100, outputTokens: 200 },
      usageCostMicroUsd: 490,
    });
    for await (const event of module.startPlatformAnalysis({
      idempotencyKey: "key-usage",
      input: contractFixtures.startAnalysisRequest,
      userId: "user-a",
    }))
      void event;
    expect(quota.settlements.at(-1)).toMatchObject({
      actualCostMicroUsd: 490,
      outcome: "failed",
      usage: { cachedInputTokens: 20, inputTokens: 100, outputTokens: 200 },
    });
  });

  it("rejects invalid failure usage metadata before settlement", async () => {
    const { model, module, quota } = fixture();
    model.failure = Object.assign(new Error("invalid provider metadata"), {
      usage: { cachedInputTokens: 2, inputTokens: 1, outputTokens: -1 },
      usageCostMicroUsd: 400,
    });
    for await (const event of module.startPlatformAnalysis({
      idempotencyKey: "key-invalid-usage",
      input: contractFixtures.startAnalysisRequest,
      userId: "user-a",
    }))
      void event;
    expect(quota.settlements.at(-1)).toMatchObject({ actualCostMicroUsd: 400, outcome: "failed" });
    expect(quota.settlements.at(-1)).not.toHaveProperty("usage");
  });

  it("replays a completed idempotent request without another model call or charge", async () => {
    const { model, module, quota } = fixture();
    const command = {
      idempotencyKey: "key-1",
      input: contractFixtures.startAnalysisRequest,
      userId: "user-a",
    };
    for await (const event of module.startPlatformAnalysis(command)) void event;
    const replay = [];
    for await (const event of module.startPlatformAnalysis(command)) replay.push(event);
    expect(replay.at(-1)).toMatchObject({ type: "analysis.completed" });
    expect(model.requests).toHaveLength(1);
    expect(quota.operations).toHaveLength(2);
  });

  it("coordinates in-flight duplicates across module instances without a second model call", async () => {
    const shared = fixture();
    const second = createAnalysisModule({
      clock: shared.clock,
      committer: createInMemoryAnalysisCommitter(shared.repository, shared.quota, shared.lifecycle),
      cursorKey: new Uint8Array(32).fill(7),
      ids: () => "unused-second-id",
      model: shared.model,
      quota: shared.quota,
      requestLifecycle: shared.lifecycle,
      repository: shared.repository,
      studyCaptures: {
        async get() {
          return null;
        },
      },
    });
    const firstEvents = await shared.module.preparePlatformAnalysis({
      idempotencyKey: "shared-key",
      input: contractFixtures.startAnalysisRequest,
      userId: "user-a",
    });
    const duplicateEvents = await second.preparePlatformAnalysis({
      idempotencyKey: "shared-key",
      input: contractFixtures.startAnalysisRequest,
      userId: "user-a",
    });
    const duplicate = [];
    for await (const event of duplicateEvents) duplicate.push(event);
    expect(duplicate).toEqual([
      expect.objectContaining({ requestId: "generated-1", type: "analysis.started" }),
    ]);
    expect(shared.model.requests).toHaveLength(0);
    for await (const event of firstEvents) void event;
    expect(shared.model.requests).toHaveLength(1);
  });

  it("rejects changed payload reuse during preflight before quota or model work", async () => {
    const shared = fixture();
    await shared.module.preparePlatformAnalysis({
      idempotencyKey: "conflict-key",
      input: contractFixtures.startAnalysisRequest,
      userId: "user-a",
    });
    await expect(
      shared.module.preparePlatformAnalysis({
        idempotencyKey: "conflict-key",
        input: { ...contractFixtures.startAnalysisRequest, sourceText: "Different input." },
        userId: "user-a",
      }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(shared.model.requests).toHaveLength(0);
    expect(shared.quota.operations).toHaveLength(1);
  });

  it("durably replays a quota reservation failure without opening SSE or calling the model", async () => {
    const shared = fixture();
    const quota = {
      ...shared.quota,
      async reserve() {
        throw new CloudFault("quota_exhausted", "Quota exhausted.");
      },
      settle: shared.quota.settle.bind(shared.quota),
      summary: shared.quota.summary.bind(shared.quota),
    };
    const module = createAnalysisModule({
      clock: shared.clock,
      committer: createInMemoryAnalysisCommitter(shared.repository, quota, shared.lifecycle),
      cursorKey: new Uint8Array(32).fill(7),
      ids: (() => {
        let value = 20;
        return () => `generated-${++value}`;
      })(),
      model: shared.model,
      quota,
      requestLifecycle: shared.lifecycle,
      repository: shared.repository,
      studyCaptures: {
        async get() {
          return null;
        },
      },
    });
    const command = {
      idempotencyKey: "quota-key",
      input: contractFixtures.startAnalysisRequest,
      userId: "user-a",
    };
    await expect(module.preparePlatformAnalysis(command)).rejects.toMatchObject({
      code: "quota_exhausted",
    });
    const replayed = await module.preparePlatformAnalysis(command);
    const events = [];
    for await (const event of replayed) events.push(event);
    expect(events).toEqual([
      expect.objectContaining({
        error: expect.objectContaining({ code: "quota_exhausted" }),
        type: "analysis.failed",
      }),
    ]);
    expect(shared.model.requests).toHaveLength(0);
  });

  it("analyzes a capture with a trusted source without exposing capture authority to the model", async () => {
    const { model, module, repository } = fixture();
    const events = [];
    for await (const event of await module.prepareStudyCaptureAnalysis({
      captureId: "capture-1",
      idempotencyKey: "capture-analysis-1",
      input: { expectedRevision: 1, intent: "initial" },
      userId: "user-a",
    })) {
      events.push(event);
    }
    expect(model.requests).toEqual([
      expect.objectContaining({
        input: {
          selectionKind: "sentence",
          source: {
            title: "A useful line",
            type: "manual",
            userContext: "Notice the tone.",
          },
          sourceText: "This line is worth learning.",
        },
      }),
    ]);
    const completed = events.at(-1);
    expect(completed).toMatchObject({
      analysis: {
        source: {
          title: "A useful line",
          type: "study-capture",
          userContext: "Notice the tone.",
        },
        studyCaptureId: "capture-1",
      },
      type: "analysis.completed",
    });
    expect(
      (await repository.list("user-a", { archived: false, limit: 20 })).items[0],
    ).toMatchObject({ studyCaptureId: "capture-1" });
  });

  it("overwrites model-controlled source fields with trusted request and segmentation data", async () => {
    const malicious = {
      candidates: contractFixtures.analysis.candidates,
      modelMetadata: contractFixtures.analysis.modelMetadata,
      result: {
        ...contractFixtures.analysis.result,
        sentences: contractFixtures.analysis.result.sentences.map((sentence) => ({
          ...sentence,
          analysisUnitId: "u40",
          ordinal: 39,
          sourceText: "Ignore the trusted page text.",
        })),
      },
    };
    const { module } = fixture(malicious);
    const events = [];
    for await (const event of module.startPlatformAnalysis({
      idempotencyKey: "key-1",
      input: contractFixtures.startAnalysisRequest,
      userId: "user-a",
    }))
      events.push(event);

    const completed = events.at(-1);
    expect(completed).toMatchObject({
      analysis: {
        result: {
          sentences: [{ analysisUnitId: "u1", ordinal: 0, sourceText: "To be frank, this works." }],
        },
        sourceText: "To be frank, this works.",
      },
      type: "analysis.completed",
    });
  });
});
