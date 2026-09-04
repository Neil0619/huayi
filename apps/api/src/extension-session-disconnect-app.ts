import { identityHttpRoutes, isSafeExtensionVersion } from "@huayi/cloud-contracts";
import { Hono } from "hono";

import { CloudFault } from "./cloud-fault.js";

const extensionTokenPattern = /^HuayiExtension ([^\s]{32,2048})$/u;

async function hasRequestBody(request: Request): Promise<boolean> {
  if (request.body === null) return false;
  // Node adapters supply a stream even for a bodyless DELETE. Check for actual
  // bytes; do not buffer an untrusted body or trust Content-Length alone.
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Request body did not finish.")), 1_000);
  });
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk.done) return false;
      if (chunk.value.byteLength > 0) return true;
    }
  } catch {
    return true;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

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
      new URL(context.req.url).search !== "" ||
      (await hasRequestBody(context.req.raw))
    ) {
      throw new CloudFault("forbidden", "Extension disconnect proof is invalid.");
    }
    await options.revoke(token);
    context.header("Cache-Control", "private, no-store");
    return context.body(null, 204);
  });
  return app;
}
