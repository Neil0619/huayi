import type { Context } from "hono";
import type { AnalysisDatabase } from "./analysis-database.js";
import type { AuthProvider } from "./auth-provider.js";
import type { ApiEnvironment } from "./environment.js";
import type { RateLimiter } from "./rate-limiter.js";
import { createPostgresMiniProgramIdentity } from "./postgres-miniprogram-identity.js";
import { createWechatApp } from "./wechat-app.js";
import { createWechatProvider } from "./wechat-provider.js";

export function createProductionMiniProgram(options: {
  environment: ApiEnvironment;
  database: AnalysisDatabase;
  rateLimiter: RateLimiter;
  auth: Pick<AuthProvider, "signInWithPassword">;
  authenticateWeb(context: Context): Promise<string>;
}) {
  const { HUAYI_WECHAT_APP_ID: appId, HUAYI_WECHAT_APP_SECRET: appSecret } = options.environment;
  if (!appId || !appSecret) return null;
  const identity = createPostgresMiniProgramIdentity({
    database: options.database,
    pepper: options.environment.HUAYI_SECRET_PEPPER,
  });
  return {
    identity,
    app: createWechatApp({
      identity,
      auth: options.auth,
      provider: createWechatProvider({ appId, appSecret }),
      authenticateWeb: options.authenticateWeb,
      rateLimiter: options.rateLimiter,
      pepper: options.environment.HUAYI_SECRET_PEPPER,
    }),
  };
}
