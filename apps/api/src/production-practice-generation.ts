import { calculateConservativeReservation } from "@huayi/cloud-contracts";

import type { AnalysisDatabase } from "./analysis-database.js";
import type { AnalysisQuota } from "./analysis-ports.js";
import {
  createDeepSeekPracticeProvider,
  deepSeekPracticeMaximumUsage,
} from "./deepseek-practice-provider.js";
import type { DeepSeekPriceSchedule } from "./deepseek-price-schedule.js";
import { createPaidPracticeGenerator } from "./paid-practice-generator.js";
import { createPostgresPracticeGenerationRepository } from "./postgres-practice-generation.js";
import { systemClock } from "./security.js";

export function createProductionPracticeGenerator(options: {
  apiKey: string;
  database: AnalysisDatabase;
  pricing: DeepSeekPriceSchedule;
  quota: AnalysisQuota;
}) {
  return createPaidPracticeGenerator({
    provider: createDeepSeekPracticeProvider({
      apiKey: options.apiKey,
      prices: options.pricing.reservation.prices,
    }),
    providerForPricing: (snapshot) =>
      createDeepSeekPracticeProvider({ apiKey: options.apiKey, prices: snapshot.prices }),
    repository: createPostgresPracticeGenerationRepository({
      database: options.database,
      ledgerId: () => crypto.randomUUID(),
      now: () => systemClock.now(),
      priceVersionId: options.pricing.reservation.priceVersionId,
      pricing: options.pricing,
      quota: options.quota,
      reservedMicroUsd: (kind) =>
        calculateConservativeReservation(
          deepSeekPracticeMaximumUsage(kind),
          options.pricing.reservation.prices,
        ),
    }),
  });
}
