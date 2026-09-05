import {
  practiceWorkspaceStartSchema,
  practiceWorkspaceControlSchema,
  practiceWorkspaceDraftSchema,
  idempotencyKeySchema,
  resourceIdSchema,
} from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";
import type { PracticeWorkspace } from "./practice-workspace.js";
export function createPracticeWorkspaceApp(options: {
  authenticate(context: Context): Promise<string>;
  workspace: PracticeWorkspace;
}) {
  const app = new Hono();
  app.use("*", async (context, next) => {
    context.header("Cache-Control", "no-store");
    await next();
  });
  const id = (context: Context) => resourceIdSchema.parse(context.req.param("id"));
  const key = (context: Context) =>
    idempotencyKeySchema.parse(context.req.header("idempotency-key"));
  app.post("/v2/practice-workspace/start", async (context) => {
    const owner = await options.authenticate(context);
    return context.json(
      await options.workspace.start(
        owner,
        practiceWorkspaceStartSchema.parse(await context.req.json<unknown>()),
        key(context),
      ),
      201,
    );
  });
  app.get("/v2/practice-workspace", async (context) =>
    context.json(await options.workspace.list(await options.authenticate(context))),
  );
  app.get("/v2/practice-workspace/:id", async (context) =>
    context.json(await options.workspace.get(await options.authenticate(context), id(context))),
  );
  app.post("/v2/practice-workspace/:id/draft", async (context) => {
    const owner = await options.authenticate(context);
    return context.json(
      await options.workspace.draft(
        owner,
        id(context),
        practiceWorkspaceDraftSchema.parse(await context.req.json<unknown>()),
      ),
    );
  });
  app.post("/v2/practice-workspace/:id/control", async (context) => {
    const owner = await options.authenticate(context);
    return context.json(
      await options.workspace.control(
        owner,
        id(context),
        practiceWorkspaceControlSchema.parse(await context.req.json<unknown>()),
        key(context),
      ),
    );
  });
  return app;
}
