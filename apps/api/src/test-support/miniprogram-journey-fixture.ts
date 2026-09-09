import { createCloudFoundationApp } from "../cloud-foundation-app.js";
import { CloudFault } from "../cloud-fault.js";
import { createPostgresFoundationIdentity } from "../postgres-foundation-identity.js";
import { createPostgresMiniProgramIdentity } from "../postgres-miniprogram-identity.js";
import { createPostgresWordLibrary } from "../postgres-word-library.js";
import { createProductionAnalysisAuthenticator } from "../production-principal-authentication.js";
import { createInMemoryRateLimiter } from "../rate-limiter.js";
import { systemClock, systemSecrets } from "../security.js";
import { authenticateWebAccountRequest } from "../web-account-authentication.js";
import { createWechatApp } from "../wechat-app.js";
import { createWordCatalogApp } from "../word-catalog-app.js";
import { createWordCatalog } from "../word-catalog.js";
import { createWordLibraryApp } from "../word-library-app.js";
import { createWordLibraryModule } from "../word-library-module.js";
import {
  createCurrentDatabaseFixture,
  createPgliteIdentitySql,
} from "./current-database-fixture.js";
import { createFoundationAuthProvider } from "./foundation-auth-provider.js";
import { createJourneyDataRights } from "./miniprogram-journey-data-rights.js";
import { createPgliteAnalysisDatabase } from "./postgres-analysis-database.js";

export const journeyOrigin = "https://app.example.test";
export const journeyPepper = "journey-test-pepper-at-least-thirty-two-characters";
export const journeyPassword = "correct horse battery staple";

export async function createMiniProgramJourneyFixture() {
  const db = await createCurrentDatabaseFixture();
  const database = createPgliteAnalysisDatabase(db);
  const web = createPostgresFoundationIdentity({
    clock: systemClock,
    pepper: journeyPepper,
    protectRefreshToken: (value) => value,
    secrets: systemSecrets,
    sql: createPgliteIdentitySql(db),
    webOrigin: journeyOrigin,
  });
  const mini = createPostgresMiniProgramIdentity({ database, pepper: journeyPepper });
  const providerAccounts = new Map<string, string>();
  const rateLimiter = createInMemoryRateLimiter(systemClock);
  const app = createCloudFoundationApp({
    apiOrigin: "https://api.example.test",
    auth: {
      ...createFoundationAuthProvider(),
      async signInWithPassword(input) {
        const userId = providerAccounts.get(input.email);
        if (!userId || input.password !== journeyPassword)
          throw new CloudFault("authentication_required", "Invalid test provider proof.");
        return { userId, email: input.email, refreshToken: "offline-refresh" };
      },
    },
    identity: web,
    googleLink: web.googleLink,
    passwordLink: web.passwordLink,
    googleAuthenticationEnabled: false,
    protectRefreshToken: (value) => value,
    unprotectRefreshToken: (value) => value,
    rateLimiter,
    webOrigin: journeyOrigin,
  });
  app.route(
    "/",
    createWechatApp({
      identity: mini,
      provider: { exchange: async (code) => ({ appId: "wx0123456789abcdef", openId: code }) },
      pepper: journeyPepper,
      authenticateWeb: (context) => authenticateWebAccountRequest(web, context),
      rateLimiter,
    }),
  );
  const authenticate = createProductionAnalysisAuthenticator(
    {
      ...web,
      authenticateMiniProgram: mini.authenticate,
    },
    { capability: "disabled" },
  );
  const words = createWordLibraryModule({
    repository: createPostgresWordLibrary(database),
    cursorKey: Buffer.alloc(32, 1),
    ids: () => crypto.randomUUID(),
    now: systemClock.now,
  });
  app.route("/", createWordLibraryApp({ authenticate, module: words }));
  app.route(
    "/",
    createWordCatalogApp({
      authenticate,
      words,
      catalog: createWordCatalog({
        database,
        cursorKey: Buffer.alloc(32, 1),
        now: systemClock.now,
      }),
    }),
  );
  const rights = createJourneyDataRights({ database, web, mini, pepper: journeyPepper });
  app.route("/", rights.app);
  return {
    ...rights,
    app,
    db,
    database,
    web,
    mini,
    // This pre-existing Web account is fixture data, not an alternate login/permission path.
    async seedWebAccount() {
      const owner = crypto.randomUUID();
      const email = `${owner}@example.test`;
      await db.query(
        "INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES($1,$1,$2,'active','Asia/Shanghai',5)",
        [owner, email],
      );
      await db.query(
        "INSERT INTO account_sign_in_methods(owner_user_id,method) VALUES($1,'password')",
        [owner],
      );
      providerAccounts.set(email, owner);
      return { owner, email };
    },
  };
}
export type MiniProgramJourneyFixture = Awaited<ReturnType<typeof createMiniProgramJourneyFixture>>;
