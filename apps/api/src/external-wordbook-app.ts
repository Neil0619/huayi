import {
  createWordbookJobRequestSchema,
  externalWordbookHttpRoutes,
  listWordbookJobsQuerySchema,
  resourceIdSchema,
  submitWordbookReceiptsRequestSchema,
  wordbookJobListResponseSchema,
  wordbookJobResourceSchema,
  wordbookJobRevisionHeadersSchema,
  wordbookJobRevisionRequestSchema,
  wordbookJobWriteHeadersSchema,
  wordbookLeaseRequestSchema,
  wordbookLeaseResponseSchema,
  wordbookReceiptResponseSchema,
} from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";

import { CloudFault } from "./cloud-fault.js";
import type { ExternalWordbookModule } from "./external-wordbook-module.js";

export interface ExternalWordbookPrincipal {
  kind: "extension" | "web";
  userId: string;
}

async function body(context: Context): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw new CloudFault("invalid_request", "Expected JSON.");
  }
}

function id(context: Context): string {
  return resourceIdSchema.parse(context.req.param("id"));
}

function createKey(context: Context): string {
  return wordbookJobWriteHeadersSchema.parse({
    "idempotency-key": context.req.header("idempotency-key"),
  })["idempotency-key"];
}

function revisionKey(context: Context, expectedRevision: number): string {
  const headers = wordbookJobRevisionHeadersSchema.parse({
    "idempotency-key": context.req.header("idempotency-key"),
    "if-match": context.req.header("if-match"),
  });
  if (Number(headers["if-match"].slice(1, -1)) !== expectedRevision) {
    throw new CloudFault("invalid_request", "If-Match must match expectedRevision.");
  }
  return headers["idempotency-key"];
}

function requireExtension(principal: ExternalWordbookPrincipal): string {
  if (principal.kind !== "extension") {
    throw new CloudFault("forbidden", "A paired Extension session is required.");
  }
  return principal.userId;
}

export function createExternalWordbookApp(options: {
  authenticate(context: Context): ExternalWordbookPrincipal | Promise<ExternalWordbookPrincipal>;
  module: ExternalWordbookModule;
}) {
  const app = new Hono();
  app.get(externalWordbookHttpRoutes.list, async (context) => {
    const principal = await options.authenticate(context);
    return context.json(
      wordbookJobListResponseSchema.parse(
        await options.module.list(
          principal.userId,
          listWordbookJobsQuerySchema.parse(context.req.query()),
        ),
      ),
    );
  });
  app.get(externalWordbookHttpRoutes.detail, async (context) => {
    const principal = await options.authenticate(context);
    const found = await options.module.get(principal.userId, id(context));
    if (found === null) throw new CloudFault("not_found", "Wordbook job not found.");
    return context.json(wordbookJobResourceSchema.parse(found));
  });
  app.post(externalWordbookHttpRoutes.create, async (context) => {
    const principal = await options.authenticate(context);
    const input = createWordbookJobRequestSchema.parse(await body(context));
    return context.json(
      wordbookJobResourceSchema.parse(
        await options.module.create(principal.userId, createKey(context), input),
      ),
      201,
    );
  });
  app.post(externalWordbookHttpRoutes.lease, async (context) => {
    const principal = await options.authenticate(context);
    const input = wordbookLeaseRequestSchema.parse(await body(context));
    return context.json(
      wordbookLeaseResponseSchema.parse(
        await options.module.lease(requireExtension(principal), id(context), input),
      ),
    );
  });
  app.post(externalWordbookHttpRoutes.receipts, async (context) => {
    const principal = await options.authenticate(context);
    const input = submitWordbookReceiptsRequestSchema.parse(await body(context));
    return context.json(
      wordbookReceiptResponseSchema.parse({
        job: await options.module.submit(
          requireExtension(principal),
          id(context),
          createKey(context),
          input,
        ),
      }),
    );
  });
  for (const [route, action] of [
    [externalWordbookHttpRoutes.retry, options.module.retry],
    [externalWordbookHttpRoutes.cancel, options.module.cancel],
  ] as const) {
    app.post(route, async (context) => {
      const principal = await options.authenticate(context);
      const input = wordbookJobRevisionRequestSchema.parse(await body(context));
      return context.json(
        wordbookJobResourceSchema.parse(
          await action(
            principal.userId,
            id(context),
            revisionKey(context, input.expectedRevision),
            input,
          ),
        ),
      );
    });
  }
  return app;
}
