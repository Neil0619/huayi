import {
  extensionQueryGenerationSchema,
  extensionQueryHttpRoutes,
  extensionQueryRequestSchema,
  writeHeadersSchema,
} from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";

import { CloudFault } from "./cloud-fault.js";
import type { ExtensionQueryModule } from "./extension-query-module.js";

async function body(context: Context): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw new CloudFault("invalid_request", "Expected JSON.");
  }
}

export function createExtensionQueryApp(options: {
  authenticate(context: Context): Promise<string> | string;
  module: ExtensionQueryModule;
}) {
  const app = new Hono();
  app.post(extensionQueryHttpRoutes.start, async (context) => {
    const userId = await options.authenticate(context);
    const headers = writeHeadersSchema.safeParse({
      "idempotency-key": context.req.header("idempotency-key"),
    });
    if (!headers.success) throw new CloudFault("invalid_request", "Idempotency-Key is required.");
    const input = extensionQueryRequestSchema.parse(await body(context));
    const events = await options.module.prepare({
      idempotencyKey: headers.data["idempotency-key"],
      input,
      userId,
    });
    return streamSSE(context, async (stream) => {
      let id = 0;
      for await (const event of events) {
        if (
          event.type === "query.preview-v2" &&
          !context.req.header("accept")?.includes("version=2")
        ) {
          if (event.update.type !== "delta") continue;
          id += 1;
          await stream.writeSSE({
            data: JSON.stringify({
              generationId: event.generationId,
              section: event.update.section,
              sequence: event.update.sequence,
              text: event.update.text,
              type: "query.preview",
            }),
            event: "query",
            id: String(id),
          });
          continue;
        }
        id += 1;
        await stream.writeSSE({ data: JSON.stringify(event), event: "query", id: String(id) });
      }
    });
  });
  app.get(extensionQueryHttpRoutes.detail, async (context) => {
    const userId = await options.authenticate(context);
    const generation = await options.module.get(userId, context.req.param("id"));
    if (generation === null) throw new CloudFault("not_found", "Query generation not found.");
    context.header("Cache-Control", "private, no-store");
    return context.json(extensionQueryGenerationSchema.parse(generation));
  });
  return app;
}
