import { createCloudFoundationApp } from "./cloud-foundation-app.js";
import { createAccountQuotaApp } from "./account-quota-app.js";
import { createAccountPreferencesApp } from "./account-preferences-app.js";
import { createExtensionPreferencesApp } from "./extension-preferences-app.js";
import {
  authenticateProductionContextRequest,
  authenticateProductionExtensionRequest,
} from "./production-extension-authentication.js";
import { createAnalysisApp } from "./analysis-app.js";
import { createPostgresAnalysisDatabase } from "./analysis-database.js";
import type { ApiEnvironment } from "./environment.js";
import {
  authenticateProductionAnalysisRequest,
  authenticateProductionPrincipalRequest,
} from "./production-principal-authentication.js";
import { createPostgresFoundationIdentity } from "./postgres-foundation-identity.js";
import { createProductionExtensionSessionDisconnect } from "./production-extension-session-disconnect.js";
import { createProductionRuntimeSql } from "./production-runtime-sql.js";
import { createProductionAdminOperations } from "./production-admin-operations.js";
import { createPostgresAccountPreferences } from "./postgres-account-preferences.js";
import { createStudyCaptureApp } from "./study-capture-app.js";
import { createLearningLibraryApp } from "./learning-library-app.js";
import { createLearningLibraryModule } from "./learning-library-module.js";
import { createLearningLibraryMaintenance } from "./learning-library-maintenance.js";
import { createPostgresLearningLibrary } from "./postgres-learning-library.js";
import { createPostgresLearningLibraryMaintenance } from "./postgres-learning-library-maintenance.js";
import {
  createProductionDuplicateSuggestionMaintenance,
  createProductionDuplicateSuggestions,
} from "./production-duplicate-suggestions.js";
export { duplicateSuggestionCleanupRoute } from "./duplicate-suggestion-maintenance-app.js";
import { createPracticeApp } from "./practice-app.js";
import { createDialoguePracticeModule } from "./dialogue-practice-module.js";
import { createPracticeModule } from "./practice-module.js";
import { createPracticeHistoryModule } from "./practice-history-module.js";
import { createPostgresPracticeHistory } from "./postgres-practice-history.js";
import { createPostgresPracticeRepository } from "./postgres-practice-repository.js";
import { createPostgresDialoguePracticeRepository } from "./postgres-dialogue-practice-repository.js";
import { createPostgresWordLibrary } from "./postgres-word-library.js";
import { createPostgresExternalWordbook } from "./postgres-external-wordbook.js";
import { createExternalWordbookApp } from "./external-wordbook-app.js";
import { createExternalWordbookModule } from "./external-wordbook-module.js";
import { createWordLibraryApp } from "./word-library-app.js";
import { createWordLibraryModule } from "./word-library-module.js";
import {
  createPostgresWordListExportRepository,
  createWordListExport,
} from "./word-list-export.js";
import { createSecretProtector } from "./secret-protection.js";
import { createPostgresRateLimiter } from "./rate-limiter.js";
import { systemClock, systemSecrets } from "./security.js";
import {
  createSupabaseAuthClientFactory,
  createSupabaseAuthProvider,
} from "./supabase-auth-provider.js";
import { createProductionPasswordRecovery } from "./production-password-recovery.js";
import { authenticateWebAccountRequest } from "./web-account-authentication.js";
import { createProductionAccountDataRights } from "./production-account-data-rights.js";
import { createProductionExtensionQuery } from "./production-extension-query.js";
import { createProductionAnalysis } from "./production-analysis.js";
import { createProductionDeepSeekPricing } from "./production-deepseek-pricing.js";
import type { DeepSeekAnalysisFetch } from "./deepseek-analysis-protocol.js";
import { createProductionPracticeGenerator } from "./production-practice-generation.js";
import { createProductionCloudWordCopy } from "./production-cloud-word-copy.js";
import { createProductionAccountSettings } from "./production-account-settings.js";
import type { Context } from "hono";
import { createProductionSecurityNotifications } from "./production-security-notifications.js";
import type { SecurityNotificationFetch } from "./resend-security-notification-sender.js";
import { createProductionStorePolicy } from "./production-store-capability.js";
export function createProductionApp(
  environment: ApiEnvironment,
  options: {
    providerFetch?: DeepSeekAnalysisFetch;
    securityNotificationFetch?: SecurityNotificationFetch;
  } = {},
) {
  const extensionPolicy = createProductionStorePolicy(environment);
  const protector = createSecretProtector({
    key: Buffer.from(environment.HUAYI_REFRESH_ENCRYPTION_KEY, "base64url"),
    secrets: systemSecrets,
  });
  const sql = createProductionRuntimeSql(environment);
  const identity = createPostgresFoundationIdentity({
    clock: systemClock,
    pepper: environment.HUAYI_SECRET_PEPPER,
    protectRefreshToken: protector.protect,
    secrets: systemSecrets,
    sql,
    webOrigin: environment.HUAYI_WEB_ORIGIN,
  });
  const authClientFactory = createSupabaseAuthClientFactory({
    publishableKey: environment.SUPABASE_PUBLISHABLE_KEY,
    url: environment.SUPABASE_URL,
  });
  const auth = createSupabaseAuthProvider(authClientFactory);
  const rateLimiter = createPostgresRateLimiter({
    clock: systemClock,
    pepper: environment.HUAYI_SECRET_PEPPER,
    sql,
  });
  const analysisDatabase = createPostgresAnalysisDatabase(sql);
  const authenticateWebAnalysis = (context: Context) => {
    const cookie = context.req.header("cookie");
    const csrf = context.req.header("x-csrf-token");
    const origin = context.req.header("origin");
    return authenticateProductionAnalysisRequest(
      identity,
      {
        ...(cookie === undefined ? {} : { cookie }),
        ...(csrf === undefined ? {} : { csrf }),
        method: context.req.method,
        ...(origin === undefined ? {} : { origin }),
      },
      extensionPolicy,
    );
  };
  const pricing = createProductionDeepSeekPricing(environment);
  const accountPreferences = createPostgresAccountPreferences(analysisDatabase);
  const { analysis, quota, studyCaptures } = createProductionAnalysis({
    database: analysisDatabase,
    environment,
    ...(options.providerFetch === undefined ? {} : { fetch: options.providerFetch }),
    pricing,
  });
  const library = createLearningLibraryModule({
    cursorKey: Buffer.from(environment.HUAYI_REFRESH_ENCRYPTION_KEY, "base64url"),
    now: () => systemClock.now(),
    repository: createPostgresLearningLibrary(analysisDatabase),
  });
  const duplicateSuggestions = createProductionDuplicateSuggestions({
    apiKey: environment.HUAYI_DEEPSEEK_API_KEY,
    database: analysisDatabase,
    ...(options.providerFetch === undefined ? {} : { fetch: options.providerFetch }),
    pricing,
  });
  const libraryMaintenance = createLearningLibraryMaintenance({
    duplicateSuggestions,
    now: () => systemClock.now(),
    repository: createPostgresLearningLibraryMaintenance(analysisDatabase),
  });
  const practiceGenerator = createProductionPracticeGenerator({
    apiKey: environment.HUAYI_DEEPSEEK_API_KEY,
    database: analysisDatabase,
    ...(options.providerFetch === undefined ? {} : { fetch: options.providerFetch }),
    pricing,
    quota,
  });
  const practice = createPracticeModule({
    generator: practiceGenerator,
    id: () => crypto.randomUUID(),
    now: () => systemClock.now(),
    repository: createPostgresPracticeRepository(analysisDatabase),
  });
  const practiceHistory = createPracticeHistoryModule({
    cursorKey: Buffer.from(environment.HUAYI_REFRESH_ENCRYPTION_KEY, "base64url"),
    now: () => systemClock.now(),
    repository: createPostgresPracticeHistory(analysisDatabase),
  });
  const words = createWordLibraryModule({
    cursorKey: Buffer.from(environment.HUAYI_REFRESH_ENCRYPTION_KEY, "base64url"),
    ids: () => crypto.randomUUID(),
    now: () => systemClock.now(),
    repository: createPostgresWordLibrary(analysisDatabase),
  });
  const externalWordbooks = createExternalWordbookModule({
    cursorKey: Buffer.from(environment.HUAYI_REFRESH_ENCRYPTION_KEY, "base64url"),
    ids: () => crypto.randomUUID(),
    leaseDurationMs: 120_000,
    leaseKey: Buffer.from(environment.HUAYI_REFRESH_ENCRYPTION_KEY, "base64url"),
    now: () => systemClock.now(),
    repository: createPostgresExternalWordbook(analysisDatabase),
  });
  const dialoguePractice = createDialoguePracticeModule({
    generator: practiceGenerator,
    id: () => crypto.randomUUID(),
    now: () => systemClock.now(),
    repository: createPostgresDialoguePracticeRepository(analysisDatabase),
  });
  const app = createCloudFoundationApp({
    apiOrigin: environment.HUAYI_API_ORIGIN,
    auth,
    ...(extensionPolicy.capability === "enabled"
      ? { extensionOrigin: extensionPolicy.extensionOrigin }
      : {}),
    googleLink: identity.googleLink,
    identity,
    passwordLink: identity.passwordLink,
    protectRefreshToken: protector.protect,
    protectTransientAuthState: protector.protect,
    rateLimiter,
    unprotectRefreshToken: protector.unprotect,
    unprotectTransientAuthState: protector.unprotect,
    webOrigin: environment.HUAYI_WEB_ORIGIN,
  });
  app.route(
    "/",
    createProductionPasswordRecovery({
      authClientFactory,
      database: analysisDatabase,
      environment,
      protectSecret: protector.protect,
      rateLimiter,
      unprotectSecret: protector.unprotect,
    }),
  );
  app.route(
    "/",
    createProductionSecurityNotifications({
      database: analysisDatabase,
      environment,
      ...(options.securityNotificationFetch === undefined
        ? {}
        : { fetch: options.securityNotificationFetch }),
    }),
  );
  if (extensionPolicy.capability === "enabled") {
    app.route(
      "/",
      createProductionExtensionSessionDisconnect({
        database: analysisDatabase,
        extensionOrigin: extensionPolicy.extensionOrigin,
        pepper: environment.HUAYI_SECRET_PEPPER,
      }),
    );
  }
  app.route(
    "/",
    createProductionAdminOperations({ database: analysisDatabase, environment, identity }),
  );
  app.route(
    "/",
    createProductionAccountDataRights({ database: analysisDatabase, environment, identity }),
  );
  app.route(
    "/",
    createAccountQuotaApp({
      authenticate: (context) => authenticateWebAccountRequest(identity, context),
      quota,
    }),
  );
  app.route(
    "/",
    createProductionAccountSettings({
      database: analysisDatabase,
      identity,
      minSupportedExtensionVersion: environment.HUAYI_MIN_SUPPORTED_EXTENSION_VERSION,
    }),
  );
  app.route(
    "/",
    createAccountPreferencesApp({
      authenticate: (context) => authenticateWebAccountRequest(identity, context),
      repository: accountPreferences,
    }),
  );
  if (extensionPolicy.capability === "enabled") {
    app.route(
      "/",
      createExtensionPreferencesApp({
        authenticate: (context) =>
          authenticateProductionExtensionRequest(identity, context, extensionPolicy),
        async read(owner) {
          const value = await accountPreferences.read(owner);
          return {
            cloudWordCopyMode: value.cloudWordCopyMode,
            extensionQueryModelMode: value.extensionQueryModelMode,
            revision: value.revision,
            studyCaptureMode: value.studyCaptureMode,
            updatedAt: value.updatedAt,
          };
        },
      }),
    );
  }
  app.route(
    "/",
    createStudyCaptureApp({
      analysis,
      authenticateCreate: (context) =>
        authenticateProductionExtensionRequest(identity, context, extensionPolicy),
      authenticateDelete: (context) =>
        authenticateProductionContextRequest(identity, context, extensionPolicy).then(
          (principal) => principal.userId,
        ),
      authenticateWeb: (context) => authenticateWebAccountRequest(identity, context),
      module: studyCaptures,
    }),
  );
  if (extensionPolicy.capability === "enabled") {
    app.route(
      "/",
      createProductionCloudWordCopy({
        database: analysisDatabase,
        identity,
        ids: () => crypto.randomUUID(),
        now: () => systemClock.now(),
        policy: extensionPolicy,
      }),
    );
    app.route(
      "/",
      createProductionExtensionQuery({
        database: analysisDatabase,
        environment,
        ...(options.providerFetch === undefined ? {} : { fetch: options.providerFetch }),
        identity,
        policy: extensionPolicy,
        pricing,
        quota,
      }),
    );
  }
  app.route(
    "/",
    createAnalysisApp({
      async authenticate(context) {
        const authorization = context.req.header("authorization");
        const cookie = context.req.header("cookie");
        const clientVersion = context.req.header("x-huayi-client-version");
        const csrf = context.req.header("x-csrf-token");
        const origin = context.req.header("origin");
        return authenticateProductionAnalysisRequest(
          identity,
          {
            ...(authorization === undefined ? {} : { authorization }),
            ...(cookie === undefined ? {} : { cookie }),
            ...(clientVersion === undefined ? {} : { clientVersion }),
            ...(csrf === undefined ? {} : { csrf }),
            method: context.req.method,
            ...(origin === undefined ? {} : { origin }),
          },
          extensionPolicy,
        );
      },
      module: analysis,
    }),
  );
  app.route(
    "/",
    createLearningLibraryApp({
      authenticate: authenticateWebAnalysis,
      maintenance: libraryMaintenance,
      module: library,
    }),
  );
  app.route(
    "/",
    createProductionDuplicateSuggestionMaintenance({
      cronSecret: environment.CRON_SECRET,
      database: analysisDatabase,
    }),
  );
  app.route(
    "/",
    createPracticeApp({
      authenticate: authenticateWebAnalysis,
      dialogueModule: dialoguePractice,
      historyModule: practiceHistory,
      module: practice,
    }),
  );
  app.route(
    "/",
    createWordLibraryApp({
      authenticate: authenticateWebAnalysis,
      exportWords: createWordListExport({
        repository: createPostgresWordListExportRepository(analysisDatabase),
      }),
      module: words,
    }),
  );
  app.route(
    "/",
    createExternalWordbookApp({
      async authenticate(context) {
        const authorization = context.req.header("authorization");
        const cookie = context.req.header("cookie");
        const clientVersion = context.req.header("x-huayi-client-version");
        const csrf = context.req.header("x-csrf-token");
        const origin = context.req.header("origin");
        return authenticateProductionPrincipalRequest(
          identity,
          {
            ...(authorization === undefined ? {} : { authorization }),
            ...(cookie === undefined ? {} : { cookie }),
            ...(clientVersion === undefined ? {} : { clientVersion }),
            ...(csrf === undefined ? {} : { csrf }),
            method: context.req.method,
            ...(origin === undefined ? {} : { origin }),
          },
          extensionPolicy,
        );
      },
      module: externalWordbooks,
    }),
  );
  app.get("/health", (context) => context.json({ service: "huayi-cloud-api", status: "ok" }));
  return app;
}
export { authenticateProductionAnalysisRequest, authenticateProductionPrincipalRequest };
