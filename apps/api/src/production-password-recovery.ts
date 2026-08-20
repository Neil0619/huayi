import type { SupabaseAuthClientFactory } from "./supabase-auth-flow.js";
import type { AnalysisDatabase } from "./analysis-database.js";
import type { ApiEnvironment } from "./environment.js";
import { createPasswordRecoveryApp } from "./password-recovery-app.js";
import { createPasswordRecoveryModule } from "./password-recovery-module.js";
import { createPostgresPasswordRecovery } from "./postgres-password-recovery.js";
import type { RateLimiter } from "./rate-limiter.js";
import { systemClock, systemSecrets } from "./security.js";
import { createSupabasePasswordRecoveryProvider } from "./supabase-password-recovery-provider.js";

export function createProductionPasswordRecovery(options: {
  authClientFactory: SupabaseAuthClientFactory;
  database: AnalysisDatabase;
  environment: ApiEnvironment;
  protectSecret(value: string): string;
  rateLimiter: RateLimiter;
  unprotectSecret(value: string): string;
}) {
  const module = createPasswordRecoveryModule({
    apiOrigin: options.environment.HUAYI_API_ORIGIN,
    protectTransientAuthState: options.protectSecret,
    provider: createSupabasePasswordRecoveryProvider(options.authClientFactory),
    repository: createPostgresPasswordRecovery({
      clock: systemClock,
      database: options.database,
      pepper: options.environment.HUAYI_SECRET_PEPPER,
      protectFlowSecret: options.protectSecret,
      secrets: systemSecrets,
      unprotectFlowSecret: options.unprotectSecret,
      webOrigin: options.environment.HUAYI_WEB_ORIGIN,
    }),
    unprotectTransientAuthState: options.unprotectSecret,
  });
  return createPasswordRecoveryApp({
    cronSecret: options.environment.CRON_SECRET,
    module,
    rateLimiter: options.rateLimiter,
    webOrigin: options.environment.HUAYI_WEB_ORIGIN,
  });
}
