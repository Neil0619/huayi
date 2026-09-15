import { Hono, type Context, type Env } from "hono";
import {
  shanbayBackfillCommandSchema,
  shanbayBackfillRoutes,
  shanbayBackfillStatusSchema,
  shanbayBackfillUnresolvedSchema,
  wordbookJobWriteHeadersSchema,
} from "@huayi/cloud-contracts";
import { CloudFault } from "./cloud-fault.js";
import type { AnalysisDatabase } from "./analysis-database.js";
import { createPostgresShanbayBackfill } from "./postgres-shanbay-backfill.js";

export function createShanbayBackfillApp(options: {
  authenticate(
    context: Context,
  ): Promise<{ kind: "extension" | "web" | "miniprogram"; userId: string }>;
  authenticateDevice(token: string): Promise<{ userId: string; holder: string }>;
  module: ReturnType<typeof createPostgresShanbayBackfill>;
}) {
  const app = new Hono();
  app.get(shanbayBackfillRoutes.status, async (context) => {
    const principal = await options.authenticate(context);
    return context.json(
      shanbayBackfillStatusSchema.parse(await options.module.status(principal.userId)),
    );
  });
  app.get(shanbayBackfillRoutes.unresolved, async (context) => {
    const principal = await options.authenticate(context);
    const cursor = context.req.query("cursor");
    if (cursor !== undefined && cursor.length > 202)
      throw new CloudFault("invalid_request", "Invalid backfill cursor.");
    return context.json(
      shanbayBackfillUnresolvedSchema.parse(
        await options.module.unresolved(principal.userId, cursor),
      ),
    );
  });
  app.post(shanbayBackfillRoutes.command, async (context) => {
    const principal = await options.authenticate(context);
    if (principal.kind === "miniprogram")
      throw new CloudFault("forbidden", "Manage backfill on the Web or Extension.");
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      throw new CloudFault("invalid_request", "Expected JSON.");
    }
    const command = shanbayBackfillCommandSchema.parse(body);
    const { "idempotency-key": key } = wordbookJobWriteHeadersSchema.parse({
      "idempotency-key": context.req.header("idempotency-key"),
    });
    let holder = `web:${principal.userId}`;
    if (principal.kind === "extension") {
      const token = context.req.header("authorization")?.slice("HuayiExtension ".length);
      if (!token) throw new CloudFault("authentication_required", "Extension session required.");
      const device = await options.authenticateDevice(token);
      if (device.userId !== principal.userId)
        throw new CloudFault("forbidden", "Extension account changed.");
      holder = device.holder;
    } else if (
      ["discover", "adopt", "claim", "renew", "resolve", "unknown"].includes(command.action)
    ) {
      throw new CloudFault("forbidden", "A paired Extension is required for this action.");
    }
    return context.json(await options.module.execute(principal.userId, holder, key, command));
  });
  return app;
}

export function mountProductionShanbayBackfill<Environment extends Env>(
  app: Hono<Environment>,
  options: Omit<Parameters<typeof createShanbayBackfillApp>[0], "module"> & {
    database: AnalysisDatabase;
  },
) {
  app.route(
    "/",
    createShanbayBackfillApp({
      ...options,
      module: createPostgresShanbayBackfill(options.database),
    }),
  );
}
