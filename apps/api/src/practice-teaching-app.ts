import { Hono, type Context } from "hono";
import {
  idempotencyKeySchema,
  practiceTeachingActionSchema,
  resourceIdSchema,
} from "@huayi/cloud-contracts";
import type { PracticeTeaching } from "./practice-teaching.js";

export function createPracticeTeachingApp(options: {
  authenticate(context: Context): Promise<string>;
  teaching: PracticeTeaching;
}) {
  const app = new Hono();
  app.use("*", async (context, next) => {
    context.header("Cache-Control", "no-store");
    await next();
  });
  app.get("/v2/practice/sessions/:id/teaching", async (context) => {
    const owner = await options.authenticate(context);
    return context.json(
      await options.teaching.get(owner, resourceIdSchema.parse(context.req.param("id"))),
    );
  });
  app.post("/v2/practice/sessions/:id/teaching-actions", async (context) => {
    const owner = await options.authenticate(context);
    return context.json(
      await options.teaching.act(
        owner,
        resourceIdSchema.parse(context.req.param("id")),
        practiceTeachingActionSchema.parse(await context.req.json<unknown>()),
        idempotencyKeySchema.parse(context.req.header("idempotency-key")),
      ),
    );
  });
  return app;
}
