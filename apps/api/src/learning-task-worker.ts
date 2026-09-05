import {
  learningTaskErrorSchema,
  learningTaskPayloadSchema,
  type LearningTaskPayload,
  type LearningTaskSnapshot,
} from "@huayi/cloud-contracts";
import type { LearningTaskExecutor } from "./learning-task-executor.js";
import type { LearningTaskStore } from "./learning-task-store.js";

function failureCode(error: unknown): NonNullable<LearningTaskSnapshot["error"]>["code"] {
  const value =
    typeof error === "object" && error !== null && "code" in error ? error.code : "internal_error";
  const parsed = learningTaskErrorSchema.shape.code.safeParse(value);
  return parsed.success ? parsed.data : "internal_error";
}
function terminal(payload: LearningTaskPayload | null) {
  if (
    payload?.type === "query.completed" ||
    payload?.type === "analysis.completed" ||
    payload?.type === "duplicates.completed"
  )
    return "completed";
  if (payload?.type === "query.failed" || payload?.type === "analysis.failed") return "failed";
  if (payload?.type === "practice.updated")
    return payload.session.status === "awaiting-feedback" ? "failed" : "completed";
  return "unknown";
}

/** Runs independently of any user subscription. The lease fences every write and dispatch. */
export function createLearningTaskWorker(options: {
  store: LearningTaskStore;
  execute: LearningTaskExecutor;
  recover?: () => Promise<void>;
  pollMs?: number;
  deadlineMs?: number;
}) {
  return {
    async runOne() {
      await options.recover?.();
      const job = await options.store.claim();
      if (!job) return { claimed: false };
      const controller = new AbortController();
      const started = performance.now();
      const timings: Record<string, number> = {
        queued: Math.max(0, Date.now() - Date.parse(job.createdAt)),
      };
      let dispatched = false;
      let cancelling = false;
      let lost = false;
      let output: LearningTaskPayload | null = null;
      const pending: LearningTaskPayload[] = [];
      let writes = Promise.resolve();
      let writeError: unknown;
      let timingVersion = 0;
      let flushedVersion = -1;
      const flush = () => {
        if (pending.length === 0 && timingVersion === flushedVersion) return;
        flushedVersion = timingVersion;
        const batch = pending.splice(0, 128);
        writes = writes
          .then(async () => {
            if (!writeError) await options.store.append(job, batch, { ...timings });
          })
          .catch((error: unknown) => {
            writeError = error;
            controller.abort();
          });
      };
      const flushTimer = setInterval(flush, 40);
      let polling = false;
      const heartbeat = setInterval(() => {
        if (polling) return;
        polling = true;
        void options.store
          .touch(job)
          .then((state) => {
            if (state !== "running") {
              cancelling = state === "cancelling";
              lost = state === "lost";
              controller.abort();
            }
          })
          .catch(() => {
            lost = true;
            controller.abort();
          })
          .finally(() => {
            polling = false;
          });
      }, options.pollMs ?? 500);
      const deadline = setTimeout(() => controller.abort(), options.deadlineMs ?? 105_000);
      let error: LearningTaskSnapshot["error"] = null;
      try {
        for await (const event of options.execute(job, {
          signal: controller.signal,
          async beforeDispatch() {
            controller.signal.throwIfAborted();
            const state = await options.store.touch(job, true);
            if (state !== "running") {
              cancelling = state === "cancelling";
              lost = state === "lost";
              controller.abort();
              controller.signal.throwIfAborted();
            }
            dispatched = true;
          },
          onTiming(stage) {
            timings[stage] ??= performance.now() - started;
            timingVersion += 1;
          },
        })) {
          output = learningTaskPayloadSchema.parse(event);
          pending.push(output);
          if (pending.length >= 128) flush();
        }
        if (output?.type === "analysis.failed" || output?.type === "query.failed") {
          error = { code: failureCode(output.error), diagnosticId: job.id };
        } else if (
          output?.type === "practice.updated" &&
          output.session.status === "awaiting-feedback"
        ) {
          error = { code: "model_unavailable", diagnosticId: job.id };
        }
      } catch (cause) {
        error = { code: failureCode(cause), diagnosticId: job.id };
      } finally {
        clearInterval(flushTimer);
        clearInterval(heartbeat);
        clearTimeout(deadline);
      }
      timings["saved"] = performance.now() - started;
      timingVersion += 1;
      flush();
      await writes;
      if (lost || writeError) return { claimed: true, id: job.id, state: "unknown" };
      // A final saved result wins a racing cancellation; otherwise acknowledge cancellation only now.
      const state =
        terminal(output) === "completed"
          ? "completed"
          : cancelling
            ? "cancelled"
            : error
              ? error.code === "internal_error" && dispatched
                ? "unknown"
                : "failed"
              : terminal(output);
      if (state === "cancelled") error = { code: "cancelled", diagnosticId: job.id };
      if (state === "unknown") error = { code: "outcome_unknown", diagnosticId: job.id };
      await options.store.finish(job, state, output, error);
      return { claimed: true, id: job.id, state };
    },
  };
}
