import {
  createLearningTaskClient,
  LearningTaskError,
  extensionQueryEventSchema,
} from "@huayi/cloud-contracts";
import { extensionSessionHeaders } from "../cloud/extension-session-headers.js";
import {
  CloudExtensionQueryError,
  type CloudExtensionQueryApi,
} from "./cloud-extension-query-api.js";
import { queryIdentity } from "./query-cache-storage.js";
import type { QueryTaskJournal } from "./query-task-journal.js";

export function createCloudTaskQueryApi(options: {
  apiOrigin: string;
  clientVersion: string;
  fetch: typeof fetch;
  journal: QueryTaskJournal;
}): CloudExtensionQueryApi {
  return {
    async *start(input, _key, token, signal) {
      const identity = await queryIdentity({
        token,
        input,
        config: "query-stream-v2:deepseek-v4-flash",
      });
      const client = createLearningTaskClient({
        request: (path, init) =>
          options.fetch(new URL(path, options.apiOrigin), {
            ...init,
            credentials: "omit",
            headers: {
              ...Object.fromEntries(new Headers(init.headers)),
              ...extensionSessionHeaders(token, options.clientVersion),
            },
          }),
      });
      let taskId: string | null = null;
      let completed = false;
      try {
        let journal = await options.journal.claim(identity);
        if (journal.taskId) {
          const existing = await client.get(journal.taskId);
          if (["failed", "cancelled"].includes(existing.state)) {
            await options.journal.forget(identity);
            journal = await options.journal.claim(identity);
          }
        }
        taskId = journal.taskId;
        if (!taskId) {
          const task = await client.submit(
            { version: 2, kind: "instant-query", input },
            journal.requestKey,
            signal,
          );
          taskId = task.id;
          await options.journal.attach(identity, taskId);
        }
        for await (const payload of client.watch(taskId, signal)) {
          const event = extensionQueryEventSchema.parse(payload);
          if (event.type === "query.completed") {
            completed = true;
            await options.journal.complete(identity);
          }
          if (event.type === "query.failed") await options.journal.forget(identity);
          yield event;
        }
      } catch (error) {
        if (signal?.aborted && taskId && !completed) {
          let stopped = await client.cancel(taskId).catch(() => {
            throw new CloudExtensionQueryError("transient");
          });
          const deadline = Date.now() + 10_000;
          while (
            ["queued", "running", "cancelling"].includes(stopped.state) &&
            Date.now() < deadline
          ) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            stopped = await client.get(taskId);
          }
          if (!["completed", "failed", "cancelled"].includes(stopped.state))
            throw new CloudExtensionQueryError("transient");
        }
        if (signal?.aborted) throw error;
        if (error instanceof LearningTaskError) {
          const kind =
            error.code === "authentication_required"
              ? "authentication"
              : error.code === "forbidden"
                ? "forbidden"
                : error.code === "quota_exhausted"
                  ? "quota-exhausted"
                  : error.code === "client_upgrade_required"
                    ? "client-upgrade-required"
                    : error.code === "network_error"
                      ? "transient"
                      : "permanent";
          throw new CloudExtensionQueryError(kind, error.diagnosticId ?? taskId ?? undefined);
        }
        throw new CloudExtensionQueryError("transient");
      }
    },
  };
}
