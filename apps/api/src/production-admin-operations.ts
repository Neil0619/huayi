import { createAdminOperationsApp } from "./admin-operations-app.js";
import { createAdminOperationsModule } from "./admin-operations-module.js";
import type { AnalysisDatabase } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { ApiEnvironment } from "./environment.js";
import { createPostgresAdminOperations } from "./postgres-admin-operations.js";
import { systemClock } from "./security.js";
import { webSessionCookie } from "./web-session-cookie.js";

interface AdminIdentity {
  authenticateWebMutation(
    sessionId: string,
    origin: string,
    csrf: string,
  ): Promise<{ reauthenticatedAt: Date; userId: string }>;
  authenticateWebSession(sessionId: string): Promise<{ reauthenticatedAt: Date; userId: string }>;
}

export function createProductionAdminOperations(options: {
  database: AnalysisDatabase;
  environment: ApiEnvironment;
  identity: AdminIdentity;
}) {
  const key = Buffer.from(options.environment.HUAYI_REFRESH_ENCRYPTION_KEY, "base64url");
  const module = createAdminOperationsModule({
    cursorKey: key,
    ids: () => crypto.randomUUID(),
    invitationTokenKey: key,
    repository: createPostgresAdminOperations({
      database: options.database,
      id: () => crypto.randomUUID(),
      now: () => systemClock.now(),
      pepper: options.environment.HUAYI_SECRET_PEPPER,
    }),
  });

  return createAdminOperationsApp({
    async authenticate(context, mutation) {
      const sessionId = webSessionCookie(context);
      if (sessionId === undefined || sessionId === "") {
        throw new CloudFault("authentication_required", "A Web session is required.");
      }
      if (!mutation) {
        const authentication = await options.identity.authenticateWebSession(sessionId);
        return {
          actorUserId: authentication.userId,
          reauthenticatedAt: authentication.reauthenticatedAt,
        };
      }
      const csrf = context.req.header("x-csrf-token");
      const origin = context.req.header("origin");
      if (csrf === undefined || origin === undefined) {
        throw new CloudFault("forbidden", "Mutation proof is required.");
      }
      const authentication = await options.identity.authenticateWebMutation(
        sessionId,
        origin,
        csrf,
      );
      return {
        actorUserId: authentication.userId,
        reauthenticatedAt: authentication.reauthenticatedAt,
      };
    },
    module,
  });
}
