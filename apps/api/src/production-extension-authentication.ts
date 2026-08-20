import type { Context } from "hono";

import { CloudFault } from "./cloud-fault.js";
import {
  authenticateProductionPrincipalRequest,
  type ExtensionRequestPolicy,
  type ProductionIdentityAuthentication,
} from "./production-principal-authentication.js";

export async function authenticateProductionExtensionRequest(
  identity: ProductionIdentityAuthentication,
  context: Context,
  policy: ExtensionRequestPolicy,
): Promise<string> {
  const principal = await authenticateProductionContextRequest(identity, context, policy);
  if (principal.kind !== "extension") {
    throw new CloudFault("forbidden", "An Extension session is required.");
  }
  return principal.userId;
}

export async function authenticateProductionContextRequest(
  identity: ProductionIdentityAuthentication,
  context: Context,
  policy: ExtensionRequestPolicy,
) {
  const authorization = context.req.header("authorization");
  const clientVersion = context.req.header("x-huayi-client-version");
  const cookie = context.req.header("cookie");
  const csrf = context.req.header("x-csrf-token");
  const origin = context.req.header("origin");
  return authenticateProductionPrincipalRequest(
    identity,
    {
      ...(authorization === undefined ? {} : { authorization }),
      ...(clientVersion === undefined ? {} : { clientVersion }),
      ...(cookie === undefined ? {} : { cookie }),
      ...(csrf === undefined ? {} : { csrf }),
      method: context.req.method,
      ...(origin === undefined ? {} : { origin }),
    },
    policy,
  );
}
