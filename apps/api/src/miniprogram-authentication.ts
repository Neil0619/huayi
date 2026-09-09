import type { Context } from "hono";
import { CloudFault } from "./cloud-fault.js";
import { setDiagnosticContext } from "./diagnostic-context.js";
import { authenticateWebAccountRequest } from "./web-account-authentication.js";
import type { ProductionIdentityAuthentication } from "./production-principal-authentication.js";

import { miniProgramToken } from "./miniprogram-token.js";
export { miniProgramToken } from "./miniprogram-token.js";

/** Opt-in only: never use this authenticator for Web account security or operators. */
export async function authenticateLearningAccountRequest(
  identity: ProductionIdentityAuthentication,
  context: Context,
): Promise<string> {
  const authorization = context.req.header("authorization");
  if (authorization === undefined) return authenticateWebAccountRequest(identity, context);
  const token = miniProgramToken(authorization);
  if (!identity.authenticateMiniProgram)
    throw new CloudFault("forbidden", "Mini-program access is disabled.");
  const { userId } = await identity.authenticateMiniProgram(token);
  setDiagnosticContext({ userId });
  return userId;
}
