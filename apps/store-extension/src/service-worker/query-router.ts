import type {
  AnalysisCancellationSignal,
  AnalysisEngine,
  AnalysisRequest,
  AnalysisResult,
  AnalysisUpdateListener,
} from "@huayi/store-domain";

import { BrowserAnalysisError } from "../analysis/analysis-error.js";

interface QueryRouterOptions {
  readonly byok: AnalysisEngine;
  readonly platform: AnalysisEngine;
  readonly readPreferences: QueryRouterOptions["syncPreferences"];
  readonly syncPreferences: () => Promise<{
    readonly extensionQueryModelMode: "platform" | "byok";
  } | null>;
}

export function createQueryRouter(options: QueryRouterOptions): AnalysisEngine {
  return {
    async analyze(
      request: AnalysisRequest,
      signal: AnalysisCancellationSignal,
      onUpdate: AnalysisUpdateListener,
    ): Promise<AnalysisResult> {
      const cached = await options.readPreferences();
      const current = await options.syncPreferences();
      if (cached?.extensionQueryModelMode === "platform" && current === null) {
        throw new BrowserAnalysisError("cloud-session-required");
      }
      const mode = current?.extensionQueryModelMode ?? "byok";
      const pinnedEngine = mode === "platform" ? options.platform : options.byok;
      return pinnedEngine.analyze(request, signal, onUpdate);
    },
  };
}
