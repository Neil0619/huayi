import { createDiagnosticsApp } from "./diagnostics-app.js";
import { createPostgresDiagnostics } from "./postgres-diagnostics.js";
import type { AnalysisDatabase } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { ApiEnvironment } from "./environment.js";
import { authenticateProductionContextRequest } from "./production-extension-authentication.js";
import type {
  ExtensionRequestPolicy,
  ProductionIdentityAuthentication,
} from "./production-principal-authentication.js";
import type { RateLimiter } from "./rate-limiter.js";
import { webSessionCookie } from "./web-session-cookie.js";

export function createProductionDiagnostics(options: {
  database: AnalysisDatabase;
  environment: ApiEnvironment;
  identity: Omit<ProductionIdentityAuthentication, "authenticateWebSession"> & {
    authenticateWebSession(session: string): Promise<{ userId: string; reauthenticatedAt: Date }>;
  };
  policy: ExtensionRequestPolicy;
  rateLimiter: RateLimiter;
}) {
  const repository = createPostgresDiagnostics(
    options.database,
    Buffer.from(options.environment.HUAYI_REFRESH_ENCRYPTION_KEY, "base64url"),
  );
  return {
    ...repository,
    app: createDiagnosticsApp({
      ...repository,
      rateLimiter: options.rateLimiter,
      authenticateClient: (context) =>
        authenticateProductionContextRequest(options.identity, context, options.policy),
      async authenticateAdmin(context) {
        const session = webSessionCookie(context);
        if (!session) throw new CloudFault("authentication_required", "A Web session is required.");
        const auth = await options.identity.authenticateWebSession(session);
        return { actorUserId: auth.userId, reauthenticatedAt: auth.reauthenticatedAt };
      },
    }),
  };
}
