import {
  acceptsQueryPreviewV2,
  extensionQueryHttpRoutes,
  extensionQueryGenerationRequestSchema,
  writeHeadersSchema,
  type ExtensionQueryEventRead,
} from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";
import { streamSSE, captureDiagnosticPayload } from "./diagnostic-stream.js";

import { CloudFault } from "./cloud-fault.js";
import type { ExtensionQueryModule } from "./extension-query-module.js";
import { createExtensionQueryReadView } from "./extension-query-read-view.js";
import { privateNegotiatedResponse } from "./private-negotiated-response.js";

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
  app.use(extensionQueryHttpRoutes.start, privateNegotiatedResponse);
  app.use(extensionQueryHttpRoutes.detail, privateNegotiatedResponse);
  app.post(extensionQueryHttpRoutes.start, async (context) => {
    const userId = await options.authenticate(context);
    const headers = writeHeadersSchema.safeParse({
      "idempotency-key": context.req.header("idempotency-key"),
    });
    if (!headers.success) throw new CloudFault("invalid_request", "Idempotency-Key is required.");
    const input = extensionQueryGenerationRequestSchema.parse(await body(context));
    const events = await options.module.prepare({
      idempotencyKey: headers.data["idempotency-key"],
      input,
      userId,
    });
    const view = createExtensionQueryReadView(context.req.header("accept"));
    const previewV2 = acceptsQueryPreviewV2(context.req.header("accept"));
    return streamSSE(context, async (stream) => {
      let id = 0;
      let bytes = 0;
      let previewBytes = 0;
      let previewsExhausted = false;
      const write = async (event: ExtensionQueryEventRead) => {
        const data = JSON.stringify(event);
        const size = Buffer.byteLength(`event: query\ndata: ${data}\nid: ${id + 1}\n\n`, "utf8");
        const preview =
          event.type === "query.preview" ||
          event.type === "query.preview-v2" ||
          event.type === "query.structure";
        if (preview) {
          // Previews are temporary. Stop their prefix within its budget, but keep consuming
          // the producer through persistence and settlement so the complete result is sent.
          if (previewsExhausted || previewBytes + size > 512 * 1024) {
            previewsExhausted = true;
            return;
          }
          previewBytes += size;
        }
        if (bytes + size > 2 * 1024 * 1024)
          throw new CloudFault("model_output_invalid", "The query response exceeds its limit.");
        bytes += size;
        id += 1;
        await stream.writeSSE({ data, event: "query", id: String(id) });
      };
      for await (const value of events) {
        captureDiagnosticPayload(value);
        const event = view.event(value);
        if (event.type === "query.preview-v2" && !previewV2) {
          if (event.update.type !== "delta") continue;
          await write({
            generationId: event.generationId,
            section: event.update.section,
            sequence: event.update.sequence,
            text: event.update.text,
            type: "query.preview",
          });
          continue;
        }
        await write(event);
      }
    });
  });
  app.get(extensionQueryHttpRoutes.detail, async (context) => {
    const userId = await options.authenticate(context);
    const generation = await options.module.get(userId, context.req.param("id"));
    if (generation === null) throw new CloudFault("not_found", "Query generation not found.");
    context.header("Cache-Control", "private, no-store");
    return context.json(
      createExtensionQueryReadView(context.req.header("accept")).generation(generation),
    );
  });
  return app;
}
