import type { DeepSeekAnalysisFetch } from "./deepseek-analysis-protocol.js";
import { captureDiagnostic } from "./diagnostic-context.js";

export function createDiagnosticProviderFetch(
  providerFetch: DeepSeekAnalysisFetch = (url, init) => fetch(url, init),
): DeepSeekAnalysisFetch {
  return async (url, init) => {
    try {
      const response = await providerFetch(url, init);
      if (response.status !== 200 && !init.signal.aborted)
        captureDiagnostic({
          code: "model_unavailable",
          stage: "http",
          httpStatus: response.status,
          provider: "deepseek",
        });
      return response;
    } catch (error) {
      if (!init.signal.aborted)
        captureDiagnostic({ code: "model_unavailable", stage: "transport", provider: "deepseek" });
      throw error;
    }
  };
}
