import { createAccountDataRightsApp } from "./account-data-rights-app.js";
import { createAccountDataRightsModule } from "./account-data-rights-module.js";
import { createAccountDataRightsWorker } from "./account-data-rights-worker.js";
import { createAccountDataRightsWorkerApp } from "./account-data-rights-worker-app.js";
import type { AnalysisDatabase } from "./analysis-database.js";
import { authenticateDataRightsRequest } from "./data-rights-authentication.js";
import type { ApiEnvironment } from "./environment.js";
import { createPostgresAccountDataRights } from "./postgres-account-data-rights.js";
import { createPostgresAccountDataRightsWorker } from "./postgres-account-data-rights-worker.js";
import { createPostgresAccountDataExportSource } from "./postgres-account-data-export-source.js";
import { hashSecret, systemClock, systemSecrets } from "./security.js";
import {
  createSupabaseAccountDataAuthority,
  createSupabaseServiceRoleClient,
} from "./supabase-account-data-authority.js";
import { Hono } from "hono";
import { webSessionCookie } from "./web-session-cookie.js";

interface DataRightsIdentity {
  authenticateDataRightsMutation(
    sessionId: string,
    origin: string,
    csrfToken: string,
  ):
    | Promise<{ reauthenticatedAt: Date; userId: string }>
    | { reauthenticatedAt: Date; userId: string };
  authenticateDataRightsSession(
    sessionId: string,
  ):
    | Promise<{ reauthenticatedAt: Date; userId: string }>
    | { reauthenticatedAt: Date; userId: string };
}

export function createProductionAccountDataRights(options: {
  database: AnalysisDatabase;
  environment: ApiEnvironment;
  identity: DataRightsIdentity;
}) {
  const authority = createSupabaseAccountDataAuthority({
    bucket: options.environment.HUAYI_ACCOUNT_EXPORT_BUCKET,
    client: createSupabaseServiceRoleClient({
      serviceRoleKey: options.environment.SUPABASE_SERVICE_ROLE_KEY,
      url: options.environment.SUPABASE_URL,
    }),
    supabaseUrl: options.environment.SUPABASE_URL,
  });
  const module = createAccountDataRightsModule({
    now: () => systemClock.now(),
    repository: createPostgresAccountDataRights(options.database, {
      id: () => crypto.randomUUID(),
      pepper: options.environment.HUAYI_SECRET_PEPPER,
    }),
    signedUrls: authority.signedUrls,
  });
  const app = new Hono();
  app.route(
    "/",
    createAccountDataRightsApp({
      authenticate: (context) =>
        authenticateDataRightsRequest(options.identity, context, (sessionId) =>
          hashSecret(sessionId, options.environment.HUAYI_SECRET_PEPPER),
        ),
      module,
      requestSessionProof: (context) => {
        const sessionId = webSessionCookie(context);
        if (sessionId === undefined) return "missing-session";
        return hashSecret(sessionId, options.environment.HUAYI_SECRET_PEPPER);
      },
    }),
  );
  app.route(
    "/",
    createAccountDataRightsWorkerApp({
      cronSecret: options.environment.CRON_SECRET,
      worker: createAccountDataRightsWorker({
        authority,
        exportSource: createPostgresAccountDataExportSource(options.database),
        now: () => systemClock.now(),
        repository: createPostgresAccountDataRightsWorker(options.database, {
          clock: systemClock,
          pepper: options.environment.HUAYI_SECRET_PEPPER,
          secrets: systemSecrets,
        }),
      }),
    }),
  );
  return app;
}
