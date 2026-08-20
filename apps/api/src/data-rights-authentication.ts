import type { Context } from "hono";

import { CloudFault } from "./cloud-fault.js";
import type { AccountDataRightsPrincipal } from "./account-data-rights-app.js";
import { webSessionCookie } from "./web-session-cookie.js";

type Awaitable<T> = Promise<T> | T;
interface DataRightsIdentity {
  authenticateDataRightsMutation(
    sessionId: string,
    origin: string,
    csrfToken: string,
  ): Awaitable<{
    reauthenticatedAt: Date;
    userId: string;
  }>;
  authenticateDataRightsSession(sessionId: string): Awaitable<{
    reauthenticatedAt: Date;
    userId: string;
  }>;
}

function sessionCookie(context: Context): string {
  const value = webSessionCookie(context);
  if (value === undefined || value === "") {
    throw new CloudFault("authentication_required", "A Web session is required.");
  }
  return value;
}

export async function authenticateDataRightsRequest(
  identity: DataRightsIdentity,
  context: Context,
  protectSession: (sessionId: string) => string,
): Promise<AccountDataRightsPrincipal> {
  const sessionId = sessionCookie(context);
  const authentication =
    context.req.method === "GET" || context.req.method === "HEAD"
      ? await identity.authenticateDataRightsSession(sessionId)
      : await (() => {
          const csrf = context.req.header("x-csrf-token");
          const origin = context.req.header("origin");
          if (csrf === undefined || origin === undefined) {
            throw new CloudFault("forbidden", "Mutation proof is required.");
          }
          return identity.authenticateDataRightsMutation(sessionId, origin, csrf);
        })();
  return {
    ownerUserId: authentication.userId,
    reauthenticatedAt: authentication.reauthenticatedAt,
    requestSessionHash: protectSession(sessionId),
  };
}
