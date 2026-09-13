import { Hono, type Context } from "hono";
import {
  idempotencyKeySchema,
  practiceReferenceRequestSchema,
  resourceIdSchema,
} from "@huayi/cloud-contracts";
import type { PracticeReference } from "./practice-reference.js";

export function createPracticeReferenceApp(options: {
  authenticate(context: Context): Promise<string>;
  reference: PracticeReference;
}) {
  const app = new Hono();
  app.use("*", async (context, next) => {
    context.header("Cache-Control", "no-store");
    await next();
  });
  app.get("/v2/practice/sessions/:id/reference", async (context) =>
    context.json(
      await options.reference.get(
        await options.authenticate(context),
        resourceIdSchema.parse(context.req.param("id")),
      ),
    ),
  );
  app.post("/v2/practice/sessions/:id/reference/reveal", async (context) =>
    context.json(
      await options.reference.reveal(
        await options.authenticate(context),
        resourceIdSchema.parse(context.req.param("id")),
        practiceReferenceRequestSchema.parse(await context.req.json<unknown>()),
        idempotencyKeySchema.parse(context.req.header("idempotency-key")),
      ),
    ),
  );
  return app;
}
