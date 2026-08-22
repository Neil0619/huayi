import {
  acceptanceProviderFetch,
  LOCAL_ACCEPTANCE_PROVIDER_KEY,
} from "./acceptance-provider-fetch.js";
import { readApiEnvironment } from "./environment.js";
import { createProductionApp } from "./production-app.js";

export function createAcceptanceApp(environment: Record<string, string | undefined>) {
  const parsed = readApiEnvironment({
    ...environment,
    HUAYI_DEEPSEEK_API_KEY: LOCAL_ACCEPTANCE_PROVIDER_KEY,
  });
  return createProductionApp(parsed, { providerFetch: acceptanceProviderFetch });
}
