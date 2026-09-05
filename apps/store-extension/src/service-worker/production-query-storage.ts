import { createQueryCache } from "./query-cache.js";
import { createQueryTaskJournal } from "./query-task-journal.js";

export function createProductionQueryStorage(storage: {
  readSession(key: string): Promise<unknown>;
  writeSession(key: string, value: unknown): Promise<void>;
}) {
  const session = (key: string) => ({
    read: () => storage.readSession(key),
    write: (value: unknown) => storage.writeSession(key, value),
  });
  return {
    queryCache: createQueryCache({ storage: session("huayi.store.query-cache.v1") }),
    queryTaskJournal: createQueryTaskJournal(session("huayi.store.query-tasks.v2")),
  };
}
