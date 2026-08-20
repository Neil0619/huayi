import { describe, expect, it, vi } from "vitest";

import {
  createPaidPracticeGenerator,
  PracticeProviderError,
  type PracticeGenerationRepository,
  type PracticeProvider,
} from "./paid-practice-generator.js";
import { createDeepSeekPriceSchedule } from "./deepseek-price-schedule.js";

const command = {
  generationId: "generation-1",
  input: { itemContent: "to be frank" },
  kind: "sentence-prompt" as const,
  leaseToken: "lease-1",
  ownerUserId: "user-1",
};

function repository(
  overrides: Partial<PracticeGenerationRepository> = {},
): PracticeGenerationRepository {
  return {
    acquire: vi.fn(async () => ({ kind: "acquired" as const, reservationId: "reservation-1" })),
    complete: vi.fn(async ({ output }) => output),
    fail: vi.fn(async () => undefined),
    markDispatched: vi.fn(async () => true),
    ...overrides,
  };
}

function provider(overrides: Partial<PracticeProvider> = {}): PracticeProvider {
  return {
    generate: vi.fn(async () => ({
      billedCalls: [
        {
          costMicroUsd: 10,
          usage: { cachedInputTokens: 0, inputTokens: 10, outputTokens: 5 },
        },
      ],
      output: { kind: "sentence-prompt" as const, prompt: "请用该表达写一句英文。" },
    })),
    ...overrides,
  };
}

describe("paid practice generator", () => {
  it("uses the repository-pinned dispatch snapshot for provider cost and settlement", async () => {
    const pricing = createDeepSeekPriceSchedule({
      legacy: "10000000-0000-4000-8000-000000000001",
      offPeak: "10000000-0000-4000-8000-000000000002",
      peak: "10000000-0000-4000-8000-000000000003",
    }).at(new Date("2026-08-17T04:00:00.000Z"));
    const store = repository({ markDispatched: vi.fn(async () => ({ pricing })) });
    const fallback = provider({ generate: vi.fn() });
    const selected = provider();
    const providerForPricing = vi.fn(() => selected);
    const generator = createPaidPracticeGenerator({
      provider: fallback,
      providerForPricing,
      repository: store,
    });

    await generator.generate(command);

    expect(providerForPricing).toHaveBeenCalledWith(pricing);
    expect(fallback.generate).not.toHaveBeenCalled();
    expect(store.complete).toHaveBeenCalledWith(expect.objectContaining({ pricing }));
  });

  it("durably marks dispatch before calling the provider and stores strict ready output", async () => {
    const order: string[] = [];
    const store = repository({
      acquire: vi.fn(async () => {
        order.push("quota-reserved");
        return { kind: "acquired" as const, reservationId: "reservation-1" };
      }),
      complete: vi.fn(async ({ output }) => {
        order.push("ready-settled");
        return output;
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
              costMicroUsd: 10,
              usage: { cachedInputTokens: 0, inputTokens: 10, outputTokens: 5 },
            },
          ],
          output: { kind: "sentence-prompt" as const, prompt: "请造句。" },
        };
      }),
    });

    const generator = createPaidPracticeGenerator({ provider: model, repository: store });
    await expect(generator.generate(command)).resolves.toEqual({
      kind: "sentence-prompt",
      prompt: "请造句。",
    });
    expect(order).toEqual([
      "quota-reserved",
      "dispatch-durable",
      "provider-called",
      "ready-settled",
    ]);
  });

  it("replays ready output and suppresses active or abandoned work without provider calls", async () => {
    const model = provider();
    const ready = createPaidPracticeGenerator({
      provider: model,
      repository: repository({
        acquire: vi.fn(async () => ({
          kind: "ready" as const,
          output: { kind: "sentence-prompt" as const, prompt: "耐久题目。" },
        })),
      }),
    });
    await expect(ready.generate(command)).resolves.toMatchObject({ prompt: "耐久题目。" });

    const pending = createPaidPracticeGenerator({
      provider: model,
      repository: repository({ acquire: vi.fn(async () => ({ kind: "pending" as const })) }),
    });
    await expect(pending.generate(command)).resolves.toBeNull();
    expect(model.generate).not.toHaveBeenCalled();
  });

  it("fences a lost dispatch and never calls the provider when the durable mark is rejected", async () => {
    const store = repository({ markDispatched: vi.fn(async () => false) });
    const model = provider();
    const generator = createPaidPracticeGenerator({ provider: model, repository: store });

    await expect(generator.generate(command)).resolves.toBeNull();
    expect(model.generate).not.toHaveBeenCalled();
    expect(store.complete).not.toHaveBeenCalled();
  });

  it("lets the repository abandon an expired durable dispatch without a second provider call", async () => {
    const store = repository({ acquire: vi.fn(async () => ({ kind: "pending" as const })) });
    const model = provider();
    const generator = createPaidPracticeGenerator({ provider: model, repository: store });

    await expect(generator.generate(command)).resolves.toBeNull();
    expect(model.generate).not.toHaveBeenCalled();
    expect(store.markDispatched).not.toHaveBeenCalled();
  });

  it("settles billed invalid output as a stable model output failure", async () => {
    const store = repository();
    const model = provider({
      generate: vi.fn(async () => ({
        billedCalls: [
          {
            costMicroUsd: 10,
            usage: { cachedInputTokens: 0, inputTokens: 10, outputTokens: 5 },
          },
        ],
        output: { kind: "sentence-feedback", feedback: "wrong operation" },
      })),
    });
    const generator = createPaidPracticeGenerator({ provider: model, repository: store });

    await expect(generator.generate(command)).resolves.toBeNull();
    expect(store.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        billedCalls: expect.any(Array),
        stableErrorCode: "model_output_invalid",
      }),
    );
  });

  it("preserves billed repair calls exposed by a provider failure", async () => {
    const store = repository();
    const billedCalls = [
      {
        costMicroUsd: 10,
        usage: { cachedInputTokens: 0, inputTokens: 10, outputTokens: 5 },
      },
    ];
    const generator = createPaidPracticeGenerator({
      provider: provider({
        generate: vi.fn(async () => {
          throw new PracticeProviderError("model_unavailable", billedCalls);
        }),
      }),
      repository: store,
    });

    await expect(generator.generate(command)).resolves.toBeNull();
    expect(store.fail).toHaveBeenCalledWith(
      expect.objectContaining({ billedCalls, stableErrorCode: "model_unavailable" }),
    );
  });
});
