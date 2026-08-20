import { identityHttpRoutes, isSafeExtensionVersion } from "@huayi/cloud-contracts";
import { Hono } from "hono";

import { CloudFault } from "./cloud-fault.js";

const extensionTokenPattern = /^HuayiExtension ([^\s]{32,2048})$/u;

export function createExtensionSessionDisconnectApp(options: {
  extensionOrigin: string;
  revoke: (token: string) => Promise<void>;
}) {
  const app = new Hono();
  app.delete(identityHttpRoutes.extensionSessionCurrent, async (context) => {
    const authorization = context.req.header("authorization");
    const clientVersion = context.req.header("x-huayi-client-version");
    const origin = context.req.header("origin");
    const token =
      authorization === undefined ? undefined : extensionTokenPattern.exec(authorization)?.[1];
    if (
      origin !== options.extensionOrigin ||
      clientVersion === undefined ||
      !isSafeExtensionVersion(clientVersion) ||
      token === undefined ||
      context.req.header("cookie") !== undefined ||
      context.req.header("idempotency-key") !== undefined ||
      context.req.header("x-csrf-token") !== undefined ||
      context.req.raw.body !== null ||
      new URL(context.req.url).search !== ""
    ) {
      throw new CloudFault("forbidden", "Extension disconnect proof is invalid.");
    }
    await options.revoke(token);
    context.header("Cache-Control", "private, no-store");
    return context.body(null, 204);
  });
  return app;
}
