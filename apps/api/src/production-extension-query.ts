import { calculateConservativeReservation } from "@huayi/cloud-contracts";

import type { AnalysisDatabase } from "./analysis-database.js";
import type { AnalysisQuota } from "./analysis-ports.js";
import {
  createDeepSeekExtensionQueryModel,
  deepSeekExtensionQueryMaximumUsage,
} from "./deepseek-extension-query-model.js";
import type { DeepSeekAnalysisFetch } from "./deepseek-analysis-protocol.js";
import type { ApiEnvironment } from "./environment.js";
import { createExtensionQueryMaintenanceApp } from "./extension-query-maintenance-app.js";
import { createExtensionQueryApp } from "./extension-query-app.js";
import { createExtensionQueryModule } from "./extension-query-module.js";
import { createPostgresExtensionQueryMaintenance } from "./postgres-extension-query-maintenance.js";
import { createPostgresExtensionQueryStore } from "./postgres-extension-query.js";
import { authenticateProductionExtensionRequest } from "./production-extension-authentication.js";
import type {
  ExtensionRequestPolicy,
  ProductionIdentityAuthentication,
} from "./production-principal-authentication.js";
import { systemClock } from "./security.js";
import { Hono } from "hono";
import type { DeepSeekPriceSchedule } from "./deepseek-price-schedule.js";

interface QueryOptions {
  database: AnalysisDatabase;
  environment: ApiEnvironment;
  fetch?: DeepSeekAnalysisFetch;
  identity: ProductionIdentityAuthentication;
  policy: ExtensionRequestPolicy;
  pricing: DeepSeekPriceSchedule;
  quota: AnalysisQuota;
}

export function createProductionExtensionQueryModule(options: QueryOptions) {
  return createExtensionQueryModule({
    ids: () => crypto.randomUUID(),
    model: createDeepSeekExtensionQueryModel({
      apiKey: options.environment.HUAYI_DEEPSEEK_API_KEY,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      prices: options.pricing.reservation.prices,
    }),
    modelForPricing: (pricing) =>
      createDeepSeekExtensionQueryModel({
        apiKey: options.environment.HUAYI_DEEPSEEK_API_KEY,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        prices: pricing.prices,
      }),
    now: () => systemClock.now(),
    pricing: options.pricing,
    quota: options.quota,
    reservedCostMicroUsd: (input) =>
      calculateConservativeReservation(
        deepSeekExtensionQueryMaximumUsage(input),
        options.pricing.reservation.prices,
      ),
    store: createPostgresExtensionQueryStore({
      database: options.database,
      ledgerId: () => crypto.randomUUID(),
      now: () => systemClock.now(),
      priceVersionId: options.pricing.reservation.priceVersionId,
    }),
  });
}

export function createProductionExtensionQuery(
  options: QueryOptions & { module?: ReturnType<typeof createProductionExtensionQueryModule> },
) {
  const app = new Hono();
  app.route(
    "/",
    createExtensionQueryApp({
      authenticate: (context) =>
        authenticateProductionExtensionRequest(options.identity, context, options.policy),
      module: options.module ?? createProductionExtensionQueryModule(options),
    }),
  );
  app.route(
    "/",
    createExtensionQueryMaintenanceApp({
      cronSecret: options.environment.CRON_SECRET,
      maintenance: createPostgresExtensionQueryMaintenance({
        database: options.database,
        ledgerId: () => crypto.randomUUID(),
      }),
    }),
  );
  return app;
}
