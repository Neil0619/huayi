import type { StoreSettings } from "@huayi/store-domain";
import { createAnalysisSession, type AnalysisSessionPort } from "./analysis-session.js";
import { analysisSourceTypeFromSenderUrl } from "./analysis-source-type.js";
import { createProductionQueryEngine } from "./production-query-engine.js";
import { siteHostFromSenderUrl } from "./site-policy-handler.js";

type QueryOptions = Parameters<typeof createProductionQueryEngine>[0];

export function createProductionQuerySession(
  port: AnalysisSessionPort & {
    readonly sender?: { readonly url?: string | undefined } | undefined;
  },
  options: Omit<QueryOptions, "sourceType"> & {
    readonly getSettings: () => Promise<StoreSettings>;
  },
): void {
  createAnalysisSession(port, {
    analysisEngine: createProductionQueryEngine({
      ...options,
      sourceType: analysisSourceTypeFromSenderUrl(port.sender?.url),
    }),
    createRequestId: () => crypto.randomUUID(),
    cancelAnalysis: (requestId) => options.cache.cancel(requestId),
    getSettings: options.getSettings,
    siteHost: siteHostFromSenderUrl(port.sender?.url),
  });
}
