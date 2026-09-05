import { useEffect, useRef, useState } from "react";
import type { DuplicateSuggestionsResponse, LearningTaskSnapshot } from "@huayi/cloud-contracts";
import type { LearningLibraryApi } from "./learning-library-api-port.js";
export function useDuplicateSuggestions(options: {
  api: Pick<LearningLibraryApi, "tasks" | "suggestLearningItemDuplicates">;
  itemId: string;
  revision: number;
  key(): string;
  completed(value: DuplicateSuggestionsResponse): void;
  failed(error: unknown): void;
}) {
  const [pending, setPending] = useState(false);
  const [task, setTask] = useState<LearningTaskSnapshot | null>(null);
  const controller = useRef<AbortController | null>(null);
  const version = useRef(0);
  useEffect(() => {
    version.current += 1;
    controller.current?.abort();
    setPending(false);
    setTask(null);
    return () => {
      version.current += 1;
      controller.current?.abort();
    };
  }, [options.itemId, options.revision]);
  const start = async () => {
    if (pending) return;
    const current = version.current;
    setPending(true);
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    try {
      if (!options.api.tasks) {
        const result = await options.api.suggestLearningItemDuplicates(
          options.itemId,
          { expectedRevision: options.revision },
          options.key(),
        );
        if (current === version.current) options.completed(result);
        return;
      }
      const client = options.api.tasks;
      const active = (await client.list()).find(
        (job) =>
          job.kind === "duplicate-suggestions" &&
          job.subjectId === options.itemId &&
          ["queued", "running", "cancelling"].includes(job.state),
      );
      const job =
        active ??
        (await client.submit(
          {
            version: 2,
            kind: "duplicate-suggestions",
            itemId: options.itemId,
            input: { expectedRevision: options.revision },
          },
          options.key(),
        ));
      if (current !== version.current) return;
      setTask(job);
      for await (const event of client.watch(job.id, abort.signal, (next) => {
        if (current === version.current) setTask(next);
      })) {
        if (
          current === version.current &&
          event.type === "duplicates.completed" &&
          event.result.itemRevision === options.revision
        )
          options.completed(event.result);
      }
    } catch (error) {
      if (current === version.current && !abort.signal.aborted) options.failed(error);
    } finally {
      if (current === version.current) setPending(false);
    }
  };
  return {
    pending,
    task,
    start,
    async cancel() {
      if (task && options.api.tasks) setTask(await options.api.tasks.cancel(task.id));
    },
  };
}
