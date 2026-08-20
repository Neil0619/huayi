import { calculateConservativeReservation } from "@huayi/cloud-contracts";

import type { AnalysisDatabase } from "./analysis-database.js";
import {
  createDeepSeekDuplicateSuggestionProvider,
  deepSeekDuplicateSuggestionMaximumUsage,
} from "./deepseek-duplicate-suggestion-provider.js";
import {
  DEEPSEEK_PLATFORM_MODEL,
  type DeepSeekAnalysisFetch,
} from "./deepseek-analysis-protocol.js";
import { createPaidDuplicateSuggestionGenerator } from "./paid-duplicate-suggestion-generator.js";
import { createDuplicateSuggestionMaintenanceApp } from "./duplicate-suggestion-maintenance-app.js";
import { createPostgresDuplicateSuggestionMaintenance } from "./postgres-duplicate-suggestion-maintenance.js";
import { createPostgresDuplicateSuggestionRepository } from "./postgres-duplicate-suggestion-repository.js";
import { systemClock } from "./security.js";
import type { DeepSeekPriceSchedule } from "./deepseek-price-schedule.js";

export function createProductionDuplicateSuggestions(options: {
  apiKey: string;
  database: AnalysisDatabase;
  fetch?: DeepSeekAnalysisFetch;
  now?: () => Date;
  pricing: DeepSeekPriceSchedule;
}) {
  const reservationPricing = options.pricing.reservation;
  return createPaidDuplicateSuggestionGenerator({
    enabled: () => true,
    newId: () => crypto.randomUUID(),
    now: options.now ?? (() => systemClock.now()),
    provider: createDeepSeekDuplicateSuggestionProvider({
      apiKey: options.apiKey,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      prices: reservationPricing.prices,
    }),
    providerForPricing: (pricing) =>
      createDeepSeekDuplicateSuggestionProvider({
        apiKey: options.apiKey,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        prices: pricing.prices,
      }),
    pricing: options.pricing,
    repository: createPostgresDuplicateSuggestionRepository({
      database: options.database,
      ledgerId: () => crypto.randomUUID(),
      prices: reservationPricing.prices,
      priceVersionId: reservationPricing.priceVersionId,
      providerModel: DEEPSEEK_PLATFORM_MODEL,
      reservationId: () => crypto.randomUUID(),
    }),
    reservedMicroUsd: calculateConservativeReservation(
      deepSeekDuplicateSuggestionMaximumUsage(),
      reservationPricing.prices,
    ),
  });
}

export function createProductionDuplicateSuggestionMaintenance(options: {
  cronSecret: string;
  database: AnalysisDatabase;
}) {
  return createDuplicateSuggestionMaintenanceApp({
    cronSecret: options.cronSecret,
    maintenance: createPostgresDuplicateSuggestionMaintenance({
      database: options.database,
      ledgerId: () => crypto.randomUUID(),
      now: () => systemClock.now(),
    }),
  });
}
