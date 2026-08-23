import type { Context } from "hono";

import type { AuthSession } from "./auth-provider.js";
import type { CloudFoundationDependencies } from "./cloud-foundation-dependencies.js";
import { CloudFault } from "./cloud-fault.js";

export async function createCloudWebSession(
  dependencies: CloudFoundationDependencies,
  session: AuthSession,
) {
  return dependencies.identity.createWebSession(
    session.userId,
    dependencies.protectRefreshToken(session.refreshToken),
    session.email,
  );
}

export async function completeCloudAuthenticationCallback(
  dependencies: CloudFoundationDependencies,
  context: Context,
) {
  context.header("Cache-Control", "private, no-store");
  context.header("Referrer-Policy", "no-referrer");
  const code = context.req.query("code");
  const flowId = context.req.query("flow");
  if (code === undefined || flowId === undefined) {
    throw new CloudFault("invalid_request", "Authentication callback is incomplete.");
  }
  const protectedState = await dependencies.identity.readAuthFlowState(flowId);
  const serializedState = (dependencies.unprotectTransientAuthState ?? ((value: string) => value))(
    protectedState,
  );
  const authSession = await dependencies.auth.completeCode({
    authState: JSON.parse(serializedState) as Record<string, string>,
    code,
  });
  await dependencies.identity.completeAuthFlow(
    flowId,
    authSession.userId,
    authSession.email,
    "google",
  );
  const session = await createCloudWebSession(dependencies, authSession);
  context.header("Set-Cookie", session.setCookie);
  return context.redirect(
    `${dependencies.webOrigin}${session.access === "full" ? "/app" : "/settings/data"}`,
    302,
  );
}
