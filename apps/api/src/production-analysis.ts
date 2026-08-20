import { calculateConservativeReservation } from "@huayi/cloud-contracts";

import type { AnalysisDatabase } from "./analysis-database.js";
import { createAnalysisModule } from "./analysis-module.js";
import { ANALYSIS_QUOTA_RESERVATION_MS } from "./analysis-timeouts.js";
import {
  createDeepSeekAnalysisModel,
  DEEPSEEK_PLATFORM_MODEL,
  deepSeekMaximumUsage,
} from "./deepseek-analysis-model.js";
import type { ApiEnvironment } from "./environment.js";
import { createPostgresAnalysisQuota } from "./postgres-analysis-quota.js";
import { createPostgresAnalysisRequestLifecycle } from "./postgres-analysis-request-lifecycle.js";
import { createPostgresAnalysisStore } from "./postgres-analysis-store.js";
import { createPostgresStudyCapture } from "./postgres-study-capture.js";
import { systemClock } from "./security.js";
import { createStudyCaptureModule } from "./study-capture-module.js";
import type { DeepSeekPriceSchedule } from "./deepseek-price-schedule.js";

export function createProductionAnalysis(options: {
  database: AnalysisDatabase;
  environment: ApiEnvironment;
  pricing: DeepSeekPriceSchedule;
}) {
  const reservationPricing = options.pricing.reservation;
  const quota = createPostgresAnalysisQuota({
    database: options.database,
    expiresAt: () => new Date(systemClock.now().getTime() + ANALYSIS_QUOTA_RESERVATION_MS),
    id: () => crypto.randomUUID(),
    now: () => systemClock.now(),
    priceVersionId: reservationPricing.priceVersionId,
    prices: reservationPricing.prices,
    providerModel: DEEPSEEK_PLATFORM_MODEL,
  });
  const store = createPostgresAnalysisStore({
    database: options.database,
    ledgerId: () => crypto.randomUUID(),
    priceVersionId: reservationPricing.priceVersionId,
  });
  const studyCaptures = createStudyCaptureModule({
    cursorKey: Buffer.from(options.environment.HUAYI_REFRESH_ENCRYPTION_KEY, "base64url"),
    now: () => systemClock.now(),
    repository: createPostgresStudyCapture(options.database),
  });
  const analysis = createAnalysisModule({
    clock: systemClock,
    committer: store,
    cursorKey: Buffer.from(options.environment.HUAYI_REFRESH_ENCRYPTION_KEY, "base64url"),
    ids: () => crypto.randomUUID(),
    model: createDeepSeekAnalysisModel({
      apiKey: options.environment.HUAYI_DEEPSEEK_API_KEY,
      prices: reservationPricing.prices,
    }),
    modelForPricing: (pricing) =>
      createDeepSeekAnalysisModel({
        apiKey: options.environment.HUAYI_DEEPSEEK_API_KEY,
        prices: pricing.prices,
      }),
    pricing: options.pricing,
    quota,
    requestLifecycle: createPostgresAnalysisRequestLifecycle(options.database),
    repository: store,
    reservedCostMicroUsd: (input) =>
      calculateConservativeReservation(deepSeekMaximumUsage(input), reservationPricing.prices),
    studyCaptures,
  });
  return { analysis, quota, studyCaptures };
}
