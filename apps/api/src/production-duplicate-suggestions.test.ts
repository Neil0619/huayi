import {
  calculateConservativeReservation,
  contractFixtures,
  learningItemDetailResponseSchema,
  type LearningItemDetailResponse,
} from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import type { CloudFault } from "./cloud-fault.js";
import { deepSeekDuplicateSuggestionMaximumUsage } from "./deepseek-duplicate-suggestion-provider.js";
import type { DeepSeekAnalysisFetch } from "./deepseek-analysis-protocol.js";
import { createProductionDuplicateSuggestions } from "./production-duplicate-suggestions.js";
import { createDeepSeekPriceSchedule } from "./deepseek-price-schedule.js";

const priceVersionId = "10000000-0000-4000-8000-000000000001";
const pricing = createDeepSeekPriceSchedule({
  legacy: "10000000-0000-4000-8000-000000000002",
  offPeak: "10000000-0000-4000-8000-000000000003",
  peak: priceVersionId,
});

function view(id: string): LearningItemDetailResponse {
  const result = contractFixtures.confirmCandidatesResponse.results[0];
  if (result.type !== "learning-item") throw new Error("Learning item fixture missing.");
  return learningItemDetailResponseSchema.parse({
    archivedAt: null,
    hasPracticeHistory: false,
    item: { ...result.item, id },
    recentPractice: null,
    schedule: { consecutiveMastered: 0, dueAt: null, level: -1 },
  });
}

function providerResponse() {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          index: 0,
          message: {
            content: JSON.stringify({
              suggestions: [{ alias: "candidate-1", confidence: 0.8, reasonZh: "语义用途接近。" }],
            }),
            role: "assistant",
          },
        },
      ],
      model: "deepseek-v4-flash",
      usage: {
        completion_tokens: 50,
        prompt_cache_hit_tokens: 0,
        prompt_tokens: 100,
        total_tokens: 150,
      },
    }),
    { headers: { "content-type": "application/json" }, status: 200 },
  );
}

function database(
  options: {
    failBegin?: "model price mismatch" | "model unavailable";
    failDispatch?: "model price mismatch";
  } = {},
) {
  const queries: { parameters: readonly unknown[]; text: string }[] = [];
  const query: AnalysisQuery = {
    async rows<Row>(text: string, parameters = []) {
      queries.push({ parameters, text });
      if (text.includes("begin_duplicate_suggestion_request")) {
        if (options.failBegin !== undefined) throw new Error(options.failBegin);
        return [
          {
            value: {
              kind: "acquired",
              reservationId: "20000000-0000-4000-8000-000000000001",
            },
          },
        ] as Row[];
      }
      if (text.includes("mark_duplicate_suggestion_dispatched")) {
        if (options.failDispatch !== undefined) throw new Error(options.failDispatch);
        return [{ value: true }] as Row[];
      }
      if (text.includes("finish_duplicate_suggestion_request")) {
        const response = JSON.parse(String(parameters[6])) as unknown;
        return [{ value: response }] as Row[];
      }
      throw new Error("Unexpected production duplicate suggestion query.");
    },
  };
  const adapter: AnalysisDatabase = {
    transaction: async (_ownerUserId, operation) => operation({ tenant: query, trusted: query }),
    trusted: async (operation) => operation(query),
  };
  return { adapter, queries };
}

function runtime(adapter: AnalysisDatabase, fetch: DeepSeekAnalysisFetch, now?: () => Date) {
  const options = {
    database: adapter,
    fetch,
    apiKey: "deepseek-test-key-at-least-20-characters",
    ...(now === undefined ? {} : { now }),
    pricing,
  };
  return createProductionDuplicateSuggestions(options);
}

describe("production duplicate suggestion composition", () => {
  it("selects pricing at durable dispatch after begin crosses a UTC window", async () => {
    const instants = [new Date("2026-08-17T03:59:59.999Z"), new Date("2026-08-17T04:00:00.000Z")];
    const store = database();
    const suggestions = runtime(
      store.adapter,
      async () => providerResponse(),
      () => instants.shift() ?? new Date("2026-08-17T04:00:00.000Z"),
    );

    await suggestions.suggest({
      candidates: [view("item-2")],
      idempotencyKey: "dispatch-boundary",
      ownerUserId: "00000000-0000-0000-0000-000000000001",
      source: view("item-1"),
    });

    const dispatch = store.queries.find(({ text }) =>
      text.includes("mark_duplicate_suggestion_dispatched"),
    );
    expect(dispatch?.parameters[5]).toBe(
      pricing.at(new Date("2026-08-17T04:00:00Z")).priceVersionId,
    );
  });

  it("reserves the fixed maximum before one provider fetch and returns a strict projection", async () => {
    const store = database();
    const fetch = vi.fn<DeepSeekAnalysisFetch>(async () => providerResponse());
    const suggestions = runtime(store.adapter, fetch);

    await expect(
      suggestions.suggest({
        candidates: [view("item-2")],
        idempotencyKey: "suggest-1",
        ownerUserId: "00000000-0000-0000-0000-000000000001",
        source: view("item-1"),
      }),
    ).resolves.toMatchObject({
      itemRevision: 1,
      suggestions: [{ candidate: { item: { id: "item-2" } }, reasonZh: "语义用途接近。" }],
    });

    const begin = store.queries.find(({ text }) =>
      text.includes("begin_duplicate_suggestion_request"),
    );
    expect(begin?.parameters).toEqual(
      expect.arrayContaining([
        priceVersionId,
        "deepseek",
        "deepseek-v4-flash",
        pricing.reservation.prices.inputMicroUsdPerMillionTokens,
        pricing.reservation.prices.cachedInputMicroUsdPerMillionTokens,
        pricing.reservation.prices.outputMicroUsdPerMillionTokens,
        calculateConservativeReservation(
          deepSeekDuplicateSuggestionMaximumUsage(),
          pricing.reservation.prices,
        ),
      ]),
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["model price mismatch", "model unavailable"] as const)(
    "fails closed on %s before provider fetch",
    async (failure) => {
      const fetch = vi.fn<DeepSeekAnalysisFetch>();
      const suggestions = runtime(database({ failBegin: failure }).adapter, fetch);
      await expect(
        suggestions.suggest({
          candidates: [view("item-2")],
          idempotencyKey: "suggest-1",
          ownerUserId: "00000000-0000-0000-0000-000000000001",
          source: view("item-1"),
        }),
      ).rejects.toEqual(
        expect.objectContaining<Partial<CloudFault>>({ code: "model_unavailable" }),
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("fails closed on a dispatch-time database price mismatch before provider fetch", async () => {
    const fetch = vi.fn<DeepSeekAnalysisFetch>();
    const suggestions = runtime(database({ failDispatch: "model price mismatch" }).adapter, fetch);

    await expect(
      suggestions.suggest({
        candidates: [view("item-2")],
        idempotencyKey: "dispatch-mismatch",
        ownerUserId: "00000000-0000-0000-0000-000000000001",
        source: view("item-1"),
      }),
    ).rejects.toMatchObject({ code: "model_unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
