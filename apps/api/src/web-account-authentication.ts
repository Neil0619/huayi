import type { Context } from "hono";

import { CloudFault } from "./cloud-fault.js";

type Awaitable<T> = Promise<T> | T;
interface WebAccountIdentity {
  authenticateWebMutation(
    sessionId: string,
    origin: string,
    csrfToken: string,
  ): Awaitable<{ userId: string }>;
  authenticateWebSession(sessionId: string): Awaitable<{ userId: string }>;
}

function sessionCookie(context: Context): string {
  const session = context.req
    .header("cookie")
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith("huayi_session="))
    ?.slice("huayi_session=".length);
  if (session === undefined || session === "") {
    throw new CloudFault("authentication_required", "A Web session is required.");
  }
  return session;
}

export async function authenticateWebAccountRequest(
  identity: WebAccountIdentity,
  context: Context,
): Promise<string> {
  const session = sessionCookie(context);
  if (context.req.method === "GET" || context.req.method === "HEAD") {
    return (await identity.authenticateWebSession(session)).userId;
  }
  const csrf = context.req.header("x-csrf-token");
  const origin = context.req.header("origin");
  if (csrf === undefined || origin === undefined) {
    throw new CloudFault("forbidden", "Mutation proof is required.");
  }
  return (await identity.authenticateWebMutation(session, origin, csrf)).userId;
}
