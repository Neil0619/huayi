import {
  cloudWordCopyBatchRequestSchema,
  cloudWordCopyBatchResponseSchema,
  cloudWordCopyHttpRoutes,
  cloudWordCopyRequestSchema,
  cloudWordCopyResponseSchema,
  writeHeadersSchema,
} from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";

import { CloudFault } from "./cloud-fault.js";
import type { CloudWordCopyModule } from "./cloud-word-copy-module.js";

function idempotencyKey(context: Context) {
  const headers = writeHeadersSchema.safeParse({
    "idempotency-key": context.req.header("idempotency-key"),
  });
  if (!headers.success) throw new CloudFault("invalid_request", "Idempotency-Key is required.");
  return headers.data["idempotency-key"];
}

export function createCloudWordCopyApp(options: {
  authenticate(context: Context): Promise<string> | string;
  module: CloudWordCopyModule;
}) {
  const app = new Hono();
  app.post(cloudWordCopyHttpRoutes.copy, async (context) => {
    const owner = await options.authenticate(context);
    const input = cloudWordCopyRequestSchema.parse(await context.req.json());
    context.header("Cache-Control", "private, no-store");
    return context.json(
      cloudWordCopyResponseSchema.parse(
        await options.module.copy(owner, idempotencyKey(context), input),
      ),
    );
  });
  app.post(cloudWordCopyHttpRoutes.importLocal, async (context) => {
    const owner = await options.authenticate(context);
    const input = cloudWordCopyBatchRequestSchema.parse(await context.req.json());
    context.header("Cache-Control", "private, no-store");
    return context.json(
      cloudWordCopyBatchResponseSchema.parse(
        await options.module.importLocal(owner, idempotencyKey(context), input),
      ),
    );
  });
  return app;
}
