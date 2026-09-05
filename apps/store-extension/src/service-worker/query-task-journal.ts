import { z } from "zod/v3";
import type { QueryCacheStorage } from "./query-cache-storage.js";
const entrySchema = z.strictObject({
  key: z.string().length(64),
  requestKey: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  createdAt: z.number(),
  completedAt: z.number().nullable(),
});
type Entry = z.infer<typeof entrySchema>;
/** Persists the submission key before sending, including the ambiguous-response window. */
export function createQueryTaskJournal(storage: QueryCacheStorage) {
  let epoch = 0;
  let entries: Entry[] = [];
  let operations = storage
    .read()
    .then((value) => {
      const parsed = z.array(entrySchema).max(100).safeParse(value);
      if (epoch === 0) entries = parsed.success ? parsed.data : [];
    })
    .catch(() => undefined);
  const mutate = <T>(operation: () => T) => {
    const currentEpoch = epoch;
    const result = operations.then(async () => {
      if (currentEpoch !== epoch) throw new Error("Query session changed.");
      const result = operation();
      await storage.write(entries);
      return result;
    });
    operations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  return {
    claim(key: string) {
      return mutate(() => {
        const now = Date.now();
        entries = entries.filter((entry) =>
          entry.completedAt === null
            ? entry.createdAt > now - 7 * 86_400_000
            : entry.completedAt > now - 30 * 60_000,
        );
        const existing = entries.find((entry) => entry.key === key);
        if (existing) return existing;
        if (entries.length >= 100) throw new Error("Too many unresolved queries.");
        const entry: Entry = {
          key,
          requestKey: crypto.randomUUID(),
          taskId: null,
          createdAt: now,
          completedAt: null,
        };
        entries.push(entry);
        return entry;
      });
    },
    attach(key: string, id: string) {
      return mutate(() => {
        const entry = entries.find((value) => value.key === key);
        if (entry) entry.taskId = id;
      });
    },
    complete(key: string) {
      return mutate(() => {
        const entry = entries.find((value) => value.key === key);
        if (entry) entry.completedAt = Date.now();
      });
    },
    forget(key: string) {
      return mutate(() => {
        entries = entries.filter((entry) => entry.key !== key);
      });
    },
    clear() {
      epoch += 1;
      return mutate(() => {
        entries = [];
      });
    },
  };
}
export type QueryTaskJournal = ReturnType<typeof createQueryTaskJournal>;
