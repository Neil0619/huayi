import { createAccountQuotaApp } from "../account-quota-app.js";
import { createCloudFoundationApp } from "../cloud-foundation-app.js";
import { CloudFault } from "../cloud-fault.js";
import { createIdentityModule } from "../identity-module.js";
import { createQuotaModule } from "../quota-module.js";
import { createInMemoryRateLimiter, type RateLimiter } from "../rate-limiter.js";
import { DeterministicSecrets, MutableClock } from "./security-fakes.js";
import { createFoundationAuthProvider } from "./foundation-auth-provider.js";

export const origin = "https://app.huayi.example";

export function createCloudFoundationTestContext(rateLimiter?: RateLimiter): {
  app: ReturnType<typeof createCloudFoundationApp>;
  auth: ReturnType<typeof createFoundationAuthProvider>;
  clock: MutableClock;
  identity: ReturnType<typeof createIdentityModule>;
  quota: ReturnType<typeof createQuotaModule>;
} {
  const clock = new MutableClock("2026-08-12T00:00:00.000Z");
  const identity = createIdentityModule({
    clock,
    pepper: "test-pepper-at-least-32-characters",
    secrets: new DeterministicSecrets(),
    webOrigin: origin,
  });
  const auth = createFoundationAuthProvider();
  const quota = createQuotaModule({ clock });
  const app = createCloudFoundationApp({
    apiOrigin: "https://api.huayi.example",
    auth,
    extensionOrigin: `chrome-extension://${"a".repeat(32)}`,
    identity,
    passwordLink: identity.passwordLink,
    googleLink: identity.googleLink,
    googleAuthenticationEnabled: true,
    protectRefreshToken: (token) => `protected:${token}`,
    protectTransientAuthState: (state) => state,
    rateLimiter: rateLimiter ?? createInMemoryRateLimiter(clock),
    unprotectRefreshToken: (token) => token.replace(/^protected:/u, ""),
    unprotectTransientAuthState: (state) => state,
    webOrigin: origin,
  });
  app.route(
    "/",
    createAccountQuotaApp({
      async authenticate(context) {
        const sessionId = context.req
          .header("cookie")
          ?.match(/(?:^|;\s*)huayi_session=([^;]+)/u)?.[1];
        if (sessionId === undefined) {
          throw new CloudFault("authentication_required", "Web session proof is required.");
        }
        return (await identity.authenticateWebSession(sessionId)).userId;
      },
      quota,
    }),
  );
  return {
    app,
    auth,
    clock,
    identity,
    quota,
  };
}
