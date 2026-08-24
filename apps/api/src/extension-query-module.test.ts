import type {
  ExtensionQueryEvent,
  ExtensionQueryGeneration,
  QuotaSummary,
} from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";

import type { ExtensionQueryStore } from "./extension-query-ports.js";
import { CloudFault } from "./cloud-fault.js";
import { DeepSeekAnalysisModelError } from "./deepseek-analysis-protocol.js";
import { createExtensionQueryModule } from "./extension-query-module.js";
import { createDeepSeekPriceSchedule } from "./deepseek-price-schedule.js";

const input = {
  action: "explain" as const,
  selectionKind: "sentence" as const,
  sourceText: "The plan fell through.",
  sourceType: "web-selection" as const,
};
const quota: QuotaSummary = {
  availableMicroUsd: 900,
  limitMicroUsd: 1_000,
  percentUsed: 10,
  periodEnd: "2026-09-01T00:00:00.000Z",
  periodStart: "2026-08-01T00:00:00.000Z",
  reservedMicroUsd: 0,
  usedMicroUsd: 100,
  warning: "available",
};
const result = {
  contextRole: "谓语",
  keyExpressions: [{ meaningZh: "落空", text: "fell through" }],
  mainStructure: "主语 + 谓语",
  requestId: "generation-1",
  selectionKind: "sentence" as const,
  sourceText: input.sourceText,
  translationZh: "计划落空了。",
  type: "explain-sentence" as const,
};

function store(): ExtensionQueryStore {
  return {
    abandon: vi.fn(async () => ({
      error: {
        code: "model_unavailable" as const,
        message: "Unavailable.",
        requestId: "generation-1",
      },
      generationId: "generation-1",
      quota,
      type: "query.failed" as const,
    })),
    attachReservation: vi.fn(async () => undefined),
    begin: vi.fn(async () => ({
      kind: "acquired" as const,
      leaseToken: "lease-1",
      id: "generation-1",
    })),
    complete: vi.fn(async () => ({
      generationId: "generation-1",
      quota,
      result,
      type: "query.completed" as const,
    })),
    fail: vi.fn(async () => ({
      error: {
        code: "model_unavailable" as const,
        message: "Unavailable.",
        requestId: "generation-1",
      },
      generationId: "generation-1",
      quota,
      type: "query.failed" as const,
    })),
    find: vi.fn(async () => null),
    markDispatched: vi.fn(async () => undefined),
    terminalizeWithoutReservation: vi.fn(async () => undefined),
  };
}

async function collect(events: AsyncIterable<ExtensionQueryEvent>) {
  const values: ExtensionQueryEvent[] = [];
  for await (const event of events) values.push(event);
  return values;
}

describe("ExtensionQuery module", () => {
  it("uses one dispatch snapshot for model pricing and terminal settlement", async () => {
    const pricing = createDeepSeekPriceSchedule({
      legacy: "10000000-0000-4000-8000-000000000001",
      offPeak: "10000000-0000-4000-8000-000000000002",
      peak: "10000000-0000-4000-8000-000000000003",
    });
    const instants = [new Date("2026-08-17T03:59:59.999Z"), new Date("2026-08-17T04:00:00.000Z")];
    const repository = store();
    const fallbackModel = vi.fn();
    const dispatchModel = vi.fn(async () => ({
      costMicroUsd: 100,
      result,
      usage: { cachedInputTokens: 0, inputTokens: 10, outputTokens: 5 },
    }));
    const modelForPricing = vi.fn(() => ({ run: dispatchModel }));
    const reserve = vi.fn(async () => ({ id: "reservation-1" }));
    const module = createExtensionQueryModule({
      ids: () => "generation-1",
      model: { run: fallbackModel },
      modelForPricing,
      now: () => instants.shift() ?? new Date("2026-08-17T04:00:00.000Z"),
      pricing,
      quota: { reserve, summary: () => quota },
      reservedCostMicroUsd: () => 500,
      store: repository,
    });

    await collect(await module.prepare({ idempotencyKey: "query-key", input, userId: "user-1" }));

    const dispatchPricing = pricing.at(new Date("2026-08-17T04:00:00.000Z"));
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({ pricing: pricing.reservation }));
    expect(repository.markDispatched).toHaveBeenCalledWith(
      expect.objectContaining({ pricing: dispatchPricing }),
    );
    expect(modelForPricing).toHaveBeenCalledWith(dispatchPricing);
    expect(fallbackModel).not.toHaveBeenCalled();
    expect(repository.complete).toHaveBeenCalledWith(
      expect.objectContaining({ priceVersionId: dispatchPricing.priceVersionId }),
    );
  });

  it("durably claims and reserves before model dispatch, then stores the terminal result", async () => {
    const calls: string[] = [];
    const repository = store();
    vi.mocked(repository.begin).mockImplementation(async () => {
      calls.push("begin");
      return { kind: "acquired", leaseToken: "lease-1", id: "generation-1" };
    });
    const reserve = vi.fn(async () => {
      calls.push("reserve");
      return { id: "reservation-1" };
    });
    vi.mocked(repository.markDispatched).mockImplementation(async () => {
      calls.push("dispatch");
    });
    const model = vi.fn(async () => {
      calls.push("model");
      return {
        costMicroUsd: 100,
        result,
        usage: { cachedInputTokens: 0, inputTokens: 10, outputTokens: 5 },
      };
    });
    const module = createExtensionQueryModule({
      ids: () => "generation-1",
      model: { run: model },
      now: () => new Date("2026-08-13T00:00:00.000Z"),
      quota: { reserve, summary: () => quota },
      reservedCostMicroUsd: () => 500,
      store: repository,
    });

    const events = await collect(
      await module.prepare({ idempotencyKey: "query-key", input, userId: "user-1" }),
    );

    expect(calls).toEqual(["begin", "reserve", "dispatch", "model"]);
    expect(events.map((event) => event.type)).toEqual(["query.started", "query.completed"]);
    expect(repository.attachReservation).toHaveBeenCalledBefore(model);
    expect(repository.markDispatched).toHaveBeenCalledBefore(model);
    expect(repository.complete).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: "reservation-1", result }),
    );
  });

  it("never calls the model when the durable dispatch mark fails", async () => {
    const repository = store();
    vi.mocked(repository.markDispatched).mockRejectedValue(new Error("dispatch mark failed"));
    const model = vi.fn();
    const module = createExtensionQueryModule({
      ids: () => "generation-1",
      model: { run: model },
      now: () => new Date("2026-08-13T00:00:00.000Z"),
      quota: {
        reserve: vi.fn(async () => ({ id: "reservation-1" })),
        summary: () => quota,
      },
      reservedCostMicroUsd: () => 500,
      store: repository,
    });

    await expect(
      collect(await module.prepare({ idempotencyKey: "query-key", input, userId: "user-1" })),
    ).rejects.toThrow("dispatch mark failed");
    expect(model).not.toHaveBeenCalled();
  });

  it("passes known provider billing through the failed settlement", async () => {
    const repository = store();
    const usage = { cachedInputTokens: 1, inputTokens: 8, outputTokens: 3 };
    const billedCalls = [{ costMicroUsd: 23, usage }];
    const module = createExtensionQueryModule({
      ids: () => "generation-1",
      model: {
        run: vi.fn(async () => {
          throw new DeepSeekAnalysisModelError("model_unavailable", 23, usage, billedCalls);
        }),
      },
      now: () => new Date("2026-08-13T00:00:00.000Z"),
      quota: {
        reserve: vi.fn(async () => ({ id: "reservation-1" })),
        summary: () => quota,
      },
      reservedCostMicroUsd: () => 500,
      store: repository,
    });

    await expect(
      collect(await module.prepare({ idempotencyKey: "query-key", input, userId: "user-1" })),
    ).resolves.toEqual([
      { generationId: "generation-1", type: "query.started" },
      expect.objectContaining({ type: "query.failed" }),
    ]);
    expect(repository.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        billedCalls,
        costMicroUsd: 23,
        reservationId: "reservation-1",
        usage,
      }),
    );
  });

  it("terminalizes quota refusal before dispatch or provider work", async () => {
    const repository = store();
    const model = vi.fn();
    const reserve = vi.fn(async () => {
      throw new CloudFault("quota_exhausted", "Quota exhausted.");
    });
    const module = createExtensionQueryModule({
      ids: () => "generation-1",
      model: { run: model },
      now: () => new Date("2026-08-13T00:00:00.000Z"),
      quota: { reserve, summary: () => quota },
      reservedCostMicroUsd: () => 500,
      store: repository,
    });

    await expect(
      module.prepare({ idempotencyKey: "query-key", input, userId: "user-1" }),
    ).rejects.toMatchObject({ code: "quota_exhausted" });
    expect(repository.terminalizeWithoutReservation).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: "quota_exhausted" }) }),
    );
    expect(repository.markDispatched).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
  });

  it("replays running and terminal claims without dispatching or switching models", async () => {
    const repository = store();
    const completed: ExtensionQueryEvent = {
      generationId: "generation-1",
      quota,
      result,
      type: "query.completed",
    };
    vi.mocked(repository.begin)
      .mockResolvedValueOnce({ id: "generation-1", kind: "running" })
      .mockResolvedValueOnce({ event: completed, id: "generation-1", kind: "terminal" });
    const model = vi.fn();
    const module = createExtensionQueryModule({
      ids: () => "unused",
      model: { run: model },
      now: () => new Date("2026-08-13T00:00:00.000Z"),
      quota: { reserve: vi.fn(), summary: () => quota },
      reservedCostMicroUsd: () => 500,
      store: repository,
    });

    const running = await collect(
      await module.prepare({ idempotencyKey: "query-key", input, userId: "user-1" }),
    );
    const terminal = await collect(
      await module.prepare({ idempotencyKey: "query-key", input, userId: "user-1" }),
    );

    expect(running).toEqual([{ generationId: "generation-1", type: "query.started" }]);
    expect(terminal).toEqual([{ generationId: "generation-1", type: "query.started" }, completed]);
    expect(model).not.toHaveBeenCalled();
  });

  it("exposes only unexpired owner-scoped generation projections", async () => {
    const repository = store();
    const generation: ExtensionQueryGeneration = {
      createdAt: "2026-08-13T00:00:00.000Z",
      expiresAt: "2026-08-13T01:00:00.000Z",
      id: "generation-1",
      result,
      state: "completed",
    };
    vi.mocked(repository.find).mockResolvedValue(generation);
    const module = createExtensionQueryModule({
      ids: () => "unused",
      model: { run: vi.fn() },
      now: () => new Date("2026-08-13T00:30:00.000Z"),
      quota: { reserve: vi.fn(), summary: () => quota },
      reservedCostMicroUsd: () => 500,
      store: repository,
    });

    await expect(module.get("user-1", "generation-1")).resolves.toEqual(generation);
    expect(repository.find).toHaveBeenCalledWith("user-1", "generation-1");
  });
});
