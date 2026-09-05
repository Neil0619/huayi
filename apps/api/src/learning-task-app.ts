import {
  idempotencyKeySchema,
  learningTaskCommandSchema,
  learningTaskEventsResponseSchema,
  learningTaskRoutes,
  learningTaskSnapshotSchema,
  resourceIdSchema,
} from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { CloudFault } from "./cloud-fault.js";
import { requireCronBearer } from "./cron-authentication.js";
import type { LearningTaskStore } from "./learning-task-store.js";

interface Principal {
  kind: "extension" | "web";
  userId: string;
}
export function createLearningTaskApp(options: {
  authenticate(context: Context): Promise<Principal>;
  store: LearningTaskStore;
  cronSecret: string;
  runWorker(): Promise<unknown>;
}) {
  const app = new Hono();
  const detail = async (principal: Principal, id: string) => {
    resourceIdSchema.parse(id);
    const snapshot = await options.store.get(principal.userId, id);
    if (!snapshot || (principal.kind === "extension" && snapshot.kind !== "instant-query")) {
      throw new CloudFault("not_found", "Task not found.");
    }
    return snapshot;
  };
  app.post(learningTaskRoutes.submit, async (context) => {
    const principal = await options.authenticate(context);
    const input = learningTaskCommandSchema.parse(await context.req.json<unknown>());
    if (principal.kind === "extension" && input.kind !== "instant-query")
      throw new CloudFault("forbidden", "Use the Web learning workspace.");
    const headers = idempotencyKeySchema.parse(context.req.header("idempotency-key"));
    context.header("Cache-Control", "private, no-store");
    return context.json(
      learningTaskSnapshotSchema.parse(
        await options.store.submit(principal.userId, headers, input),
      ),
      202,
    );
  });
  app.get(learningTaskRoutes.list, async (context) => {
    const principal = await options.authenticate(context);
    context.header("Cache-Control", "private, no-store");
    return context.json(
      (await options.store.list(principal.userId))
        .filter((task) => principal.kind !== "extension" || task.kind === "instant-query")
        .map((task) => learningTaskSnapshotSchema.parse(task)),
    );
  });
  app.get(learningTaskRoutes.detail, async (context) => {
    const principal = await options.authenticate(context);
    context.header("Cache-Control", "private, no-store");
    return context.json(await detail(principal, context.req.param("id")));
  });
  app.post(learningTaskRoutes.cancel, async (context) => {
    const principal = await options.authenticate(context);
    const task = await detail(principal, context.req.param("id"));
    context.header("Cache-Control", "private, no-store");
    return context.json(
      learningTaskSnapshotSchema.parse(await options.store.cancel(principal.userId, task.id)),
    );
  });
  app.get(learningTaskRoutes.events, async (context) => {
    const principal = await options.authenticate(context);
    const id = context.req.param("id");
    await detail(principal, id);
    const rawCursor = context.req.query("cursor") ?? context.req.header("last-event-id") ?? "0";
    if (!/^\d{1,9}$/u.test(rawCursor))
      throw new CloudFault("invalid_request", "Invalid event cursor.");
    let cursor = Number(rawCursor);
    context.header("Cache-Control", "private, no-store");
    const read = async () => {
      const events = await options.store.events(principal.userId, id, cursor);
      const snapshot = await detail(principal, id);
      return learningTaskEventsResponseSchema.parse({ snapshot, events });
    };
    if (!context.req.header("accept")?.includes("text/event-stream"))
      return context.json(await read());
    return streamSSE(context, async (stream) => {
      const end = Date.now() + 20_000;
      while (!stream.aborted && Date.now() < end) {
        const update = await read();
        for (const event of update.events) {
          await stream.writeSSE({
            event: "learning-task",
            id: String(event.cursor),
            data: JSON.stringify(event),
          });
          cursor = event.cursor;
        }
        await stream.writeSSE({ event: "task-status", data: JSON.stringify(update.snapshot) });
        if (
          cursor >= update.snapshot.cursor &&
          !["queued", "running", "cancelling"].includes(update.snapshot.state)
        )
          break;
        await stream.sleep(100);
      }
    });
  });
  app.get(learningTaskRoutes.worker, async (context) => {
    requireCronBearer(context, options.cronSecret, "Worker authentication is required.");
    return context.json(await options.runWorker());
  });
  return app;
}
