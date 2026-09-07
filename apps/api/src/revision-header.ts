import type { Context } from "hono";

import { CloudFault } from "./cloud-fault.js";

// Keep legacy clients compatible without treating application revisions as HTTP entity tags.
export function readRevisionHeader(context: Context): string | undefined {
  const revision = context.req.header("x-huayi-revision");
  const legacy = context.req.header("if-match");
  if (revision !== undefined && legacy !== undefined && revision !== legacy) {
    throw new CloudFault("invalid_request", "Revision headers must match.");
  }
  return revision ?? legacy;
}
