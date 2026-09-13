import {
  idempotencyKeySchema,
  learningTaskCommandReadSchema,
  learningTaskEventsReadResponseSchema,
  learningTaskRoutes,
  learningTaskSnapshotReadSchema,
  resourceIdSchema,
} from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";
import { streamSSE } from "./diagnostic-stream.js";
import { CloudFault } from "./cloud-fault.js";
import { requireCronBearer } from "./cron-authentication.js";
import type { LearningTaskStore } from "./learning-task-store.js";
import { createLearningTaskReadView } from "./learning-task-read-view.js";
import { privateNegotiatedResponse } from "./private-negotiated-response.js";

// Readers cap each connection at 4 MiB. A clean close with the authoritative snapshot lets
// them resume at the last event cursor without retrying generation or dropping an event.
const CONNECTION_BYTE_LIMIT = 3 * 1024 * 1024;

interface Principal {
  kind: "extension" | "web" | "miniprogram";
  userId: string;
}
export function createLearningTaskApp(options: {
  authenticate(context: Context): Promise<Principal>;
  store: LearningTaskStore;
  cronSecret: string;
  runWorker(): Promise<unknown>;
}) {
  const app = new Hono();
  app.use(learningTaskRoutes.submit, privateNegotiatedResponse);
  app.use(`${learningTaskRoutes.submit}/*`, privateNegotiatedResponse);
  const detail = async (principal: Principal, id: string) => {
    resourceIdSchema.parse(id);
    const snapshot = await options.store.get(principal.userId, id);
    if (
      !snapshot ||
      (principal.kind === "extension" && snapshot.kind !== "instant-query") ||
      (principal.kind === "miniprogram" && snapshot.kind === "instant-query")
    ) {
      throw new CloudFault("not_found", "Task not found.");
    }
    return snapshot;
  };
  app.post(learningTaskRoutes.submit, async (context) => {
    const principal = await options.authenticate(context);
    const input = learningTaskCommandReadSchema.parse(await context.req.json<unknown>());
    if (principal.kind === "extension" && input.kind !== "instant-query")
      throw new CloudFault("forbidden", "Use the Web learning workspace.");
    if (principal.kind === "miniprogram" && input.kind === "instant-query")
      throw new CloudFault("forbidden", "Instant query requires an Extension.");
    const headers = idempotencyKeySchema.parse(context.req.header("idempotency-key"));
    context.header("Cache-Control", "private, no-store");
    return context.json(
      createLearningTaskReadView(context.req.header("accept")).snapshot(
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
        .filter((task) => principal.kind !== "miniprogram" || task.kind !== "instant-query")
        .map((task) => createLearningTaskReadView(context.req.header("accept")).snapshot(task)),
    );
  });
  app.get(learningTaskRoutes.detail, async (context) => {
    const principal = await options.authenticate(context);
    context.header("Cache-Control", "private, no-store");
    return context.json(
      createLearningTaskReadView(context.req.header("accept")).snapshot(
        await detail(principal, context.req.param("id")),
      ),
    );
  });
  app.post(learningTaskRoutes.cancel, async (context) => {
    const principal = await options.authenticate(context);
    const task = await detail(principal, context.req.param("id"));
    context.header("Cache-Control", "private, no-store");
    return context.json(
      createLearningTaskReadView(context.req.header("accept")).snapshot(
        learningTaskSnapshotReadSchema.parse(await options.store.cancel(principal.userId, task.id)),
      ),
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
    const view = createLearningTaskReadView(context.req.header("accept"));
    context.header("Cache-Control", "private, no-store");
    const read = async () => {
      const events = await options.store.events(principal.userId, id, cursor);
      const snapshot = await detail(principal, id);
      return learningTaskEventsReadResponseSchema.parse({ snapshot, events });
    };
    if (!context.req.header("accept")?.includes("text/event-stream"))
      return context.json(view.page(await read()));
    return streamSSE(context, async (stream) => {
      const end = Date.now() + 20_000;
      let bytes = 0;
      while (!stream.aborted && Date.now() < end) {
        const update = await read();
        const status = view.statusFrame(update.snapshot);
        if (bytes + status.bytes > CONNECTION_BYTE_LIMIT) break;
        let limited = false;
        for (const event of update.events) {
          const next = view.eventFrame(event);
          if (next.bytes + status.bytes > CONNECTION_BYTE_LIMIT)
            throw new CloudFault("model_output_invalid", "The task update exceeds its limit.");
          if (bytes + next.bytes + status.bytes > CONNECTION_BYTE_LIMIT) {
            limited = true;
            break;
          }
          await stream.writeSSE(next.message);
          bytes += next.bytes;
          cursor = event.cursor;
        }
        await stream.writeSSE(status.message);
        bytes += status.bytes;
        if (limited) break;
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
