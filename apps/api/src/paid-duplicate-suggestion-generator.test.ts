import {
  contractFixtures,
  learningItemDetailResponseSchema,
  type DuplicateSuggestionsResponse,
  type LearningItemDetailResponse,
} from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";

import { CloudFault } from "./cloud-fault.js";
import {
  createPaidDuplicateSuggestionGenerator,
  DuplicateSuggestionProviderError,
  type DuplicateSuggestionGenerationRepository,
  type DuplicateSuggestionProvider,
} from "./paid-duplicate-suggestion-generator.js";

function view(id: string, revision = 1): LearningItemDetailResponse {
  const result = contractFixtures.confirmCandidatesResponse.results[0];
  if (result.type !== "learning-item") throw new Error("Learning item fixture missing.");
  return learningItemDetailResponseSchema.parse({
    archivedAt: null,
    hasPracticeHistory: false,
    item: { ...result.item, id, revision },
    recentPractice: null,
    schedule: { consecutiveMastered: 0, dueAt: null, level: -1 },
  });
}

const input = {
  candidates: [view("item-2"), view("item-3", 2)],
  idempotencyKey: "suggest-1",
  ownerUserId: "user-1",
  source: view("item-1", 3),
};

function emptyResponse(): DuplicateSuggestionsResponse {
  return { itemRevision: 3, suggestions: [] };
}

function repository(
  overrides: Partial<DuplicateSuggestionGenerationRepository> = {},
): DuplicateSuggestionGenerationRepository {
  return {
    begin: vi.fn(async () => ({ kind: "acquired" as const, reservationId: "reservation-1" })),
    complete: vi.fn(async ({ response }) => response),
    fail: vi.fn(async () => undefined),
    markDispatched: vi.fn(async () => true),
    ...overrides,
  };
}

function provider(
  overrides: Partial<DuplicateSuggestionProvider> = {},
): DuplicateSuggestionProvider {
  return {
    generate: vi.fn(async () => ({
      billedCalls: [
        {
          costMicroUsd: 15,
          usage: { cachedInputTokens: 0, inputTokens: 10, outputTokens: 5 },
        },
      ],
      suggestions: [{ alias: "candidate-1", confidence: 0.8, reasonZh: "语义用途相近。" }],
    })),
    ...overrides,
  };
}

function generator(options: {
  enabled?: boolean;
  provider?: DuplicateSuggestionProvider;
  repository?: DuplicateSuggestionGenerationRepository;
}) {
  const ids = ["request-1", "lease-1"];
  return createPaidDuplicateSuggestionGenerator({
    enabled: () => options.enabled ?? true,
    newId: () => ids.shift() ?? "unexpected-id",
    now: () => new Date("2026-08-14T02:00:00.000Z"),
    provider: options.provider ?? provider(),
    repository: options.repository ?? repository(),
    reservedMicroUsd: 1_000,
  });
}

describe("paid duplicate suggestion generator", () => {
  it("returns deterministic empty suggestions without repository or provider work", async () => {
    const store = repository();
    const model = provider();
    const command = { ...input, candidates: [] };

    await expect(
      generator({ provider: model, repository: store }).suggest(command),
    ).resolves.toEqual(emptyResponse());
    expect(store.begin).not.toHaveBeenCalled();
    expect(store.markDispatched).not.toHaveBeenCalled();
    expect(model.generate).not.toHaveBeenCalled();

    await expect(
      generator({ enabled: false, provider: model, repository: store }).suggest(command),
    ).resolves.toEqual(emptyResponse());
    expect(store.begin).not.toHaveBeenCalled();
    expect(store.markDispatched).not.toHaveBeenCalled();
    expect(model.generate).not.toHaveBeenCalled();
  });

  it("reserves and durably marks dispatch before sending only aliases and typed content", async () => {
    const order: string[] = [];
    const store = repository({
      begin: vi.fn(async () => {
        order.push("reserved");
        return { kind: "acquired" as const, reservationId: "reservation-1" };
      }),
      complete: vi.fn(async ({ response }) => {
        order.push("completed-settled");
        return response;
      }),
      markDispatched: vi.fn(async () => {
        order.push("dispatch-durable");
        return true;
      }),
    });
    const model = provider({
      generate: vi.fn(async () => {
        order.push("provider-called");
        return {
          billedCalls: [
            {
              costMicroUsd: 15,
              usage: { cachedInputTokens: 0, inputTokens: 10, outputTokens: 5 },
            },
          ],
          suggestions: [{ alias: "candidate-1", confidence: 0.8, reasonZh: "用途接近。" }],
        };
      }),
    });

    await expect(generator({ provider: model, repository: store }).suggest(input)).resolves.toEqual(
      {
        itemRevision: 3,
        suggestions: [{ candidate: view("item-2"), confidence: 0.8, reasonZh: "用途接近。" }],
      },
    );
    expect(order).toEqual(["reserved", "dispatch-durable", "provider-called", "completed-settled"]);
    expect(model.generate).toHaveBeenCalledWith({
      candidates: [
        { alias: "candidate-1", content: view("item-2").item.content },
        { alias: "candidate-2", content: view("item-3", 2).item.content },
      ],
      source: { content: view("item-1", 3).item.content },
    });
    expect(store.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateAliases: [
          { alias: "candidate-1", itemId: "item-2", itemRevision: 1 },
          { alias: "candidate-2", itemId: "item-3", itemRevision: 2 },
        ],
        leaseToken: "lease-1",
        ownerUserId: "user-1",
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        requestId: "request-1",
        reservedMicroUsd: 1_000,
        sourceItemId: "item-1",
        sourceRevision: 3,
      }),
    );
  });

  it("returns durable empty and replay results without dispatching the provider", async () => {
    const model = provider();
    const resolved = repository({
      begin: vi.fn(async () => ({ kind: "resolved" as const, response: emptyResponse() })),
    });
    await expect(
      generator({ provider: model, repository: resolved }).suggest({ ...input, candidates: [] }),
    ).resolves.toEqual(emptyResponse());
    await expect(
      generator({ provider: model, repository: resolved }).suggest(input),
    ).resolves.toEqual(emptyResponse());
    expect(model.generate).not.toHaveBeenCalled();
    expect(resolved.markDispatched).not.toHaveBeenCalled();
  });

  it("maps active work and a lost dispatch lease to generation_busy without a provider call", async () => {
    const model = provider();
    const busy = repository({ begin: vi.fn(async () => ({ kind: "busy" as const })) });
    await expect(
      generator({ provider: model, repository: busy }).suggest(input),
    ).rejects.toMatchObject({
      code: "generation_busy",
    });
    const fenced = repository({ markDispatched: vi.fn(async () => false) });
    await expect(
      generator({ provider: model, repository: fenced }).suggest(input),
    ).rejects.toMatchObject({ code: "generation_busy" });
    expect(model.generate).not.toHaveBeenCalled();
  });

  it("filters unknown and repeated aliases before persisting authorized projections", async () => {
    const model = provider({
      generate: vi.fn(async () => ({
        billedCalls: [],
        suggestions: [
          { alias: "candidate-10", confidence: 1, reasonZh: "未知。" },
          { alias: "candidate-1", confidence: 0.8, reasonZh: "第一条。" },
          { alias: "candidate-1", confidence: 0.7, reasonZh: "重复。" },
          { alias: "candidate-2", confidence: 0.6, reasonZh: "第二条。" },
        ],
      })),
    });
    await expect(generator({ provider: model }).suggest(input)).resolves.toMatchObject({
      suggestions: [
        { candidate: { item: { id: "item-2" } }, reasonZh: "第一条。" },
        { candidate: { item: { id: "item-3" } }, reasonZh: "第二条。" },
      ],
    });
  });

  it("fails closed before reservation when the platform kill switch is disabled", async () => {
    const store = repository();
    await expect(
      generator({ enabled: false, repository: store }).suggest(input),
    ).rejects.toMatchObject({
      code: "model_unavailable",
    });
    expect(store.begin).not.toHaveBeenCalled();
  });

  it("propagates quota refusal before dispatch", async () => {
    const store = repository({
      begin: vi.fn(async () => {
        throw new CloudFault("quota_exhausted", "Quota exhausted.");
      }),
    });
    const model = provider();
    await expect(
      generator({ provider: model, repository: store }).suggest(input),
    ).rejects.toMatchObject({
      code: "quota_exhausted",
    });
    expect(model.generate).not.toHaveBeenCalled();
  });

  it("settles strict-output and ambiguous provider failures with stable public errors", async () => {
    const invalidStore = repository();
    const billedCalls = [
      { costMicroUsd: 15, usage: { cachedInputTokens: 0, inputTokens: 10, outputTokens: 5 } },
    ];
    const invalid = provider({
      generate: vi.fn(async () => ({ billedCalls, suggestions: [{ wrong: true }] })),
    });
    await expect(
      generator({ provider: invalid, repository: invalidStore }).suggest(input),
    ).rejects.toMatchObject({ code: "model_output_invalid" });
    expect(invalidStore.fail).toHaveBeenCalledWith(
      expect.objectContaining({ billedCalls, stableErrorCode: "model_output_invalid" }),
    );

    const ambiguousStore = repository();
    const unavailable = provider({
      generate: vi.fn(async () => {
        throw new DuplicateSuggestionProviderError("model_unavailable");
      }),
    });
    await expect(
      generator({ provider: unavailable, repository: ambiguousStore }).suggest(input),
    ).rejects.toMatchObject({ code: "model_unavailable" });
    expect(ambiguousStore.fail).toHaveBeenCalledWith(
      expect.not.objectContaining({ billedCalls: expect.anything() }),
    );
  });
});
