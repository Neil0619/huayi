import { expect, it, vi } from "vitest";
import { createQueryTaskJournal } from "./query-task-journal.js";
import type { QueryCacheStorage } from "./query-cache-storage.js";
function storage() {
  let value: unknown = [];
  return {
    read: async () => structuredClone(value),
    write: vi.fn(async (next: unknown) => {
      value = structuredClone(next);
    }),
  } satisfies QueryCacheStorage;
}
it("persists a submission key before HTTP and resumes an ambiguous response after worker restart", async () => {
  const disk = storage();
  const first = createQueryTaskJournal(disk);
  const entry = await first.claim("a".repeat(64));
  expect(disk.write).toHaveBeenCalledOnce();
  const restarted = createQueryTaskJournal(disk);
  const concurrent = await Promise.all([restarted.claim(entry.key), restarted.claim(entry.key)]);
  expect(concurrent.every((value) => value.requestKey === entry.requestKey)).toBe(true);
  const id = crypto.randomUUID();
  await restarted.attach(entry.key, id);
  expect((await createQueryTaskJournal(disk).claim(entry.key)).taskId).toBe(id);
});
it("clears account journals even when an earlier storage write is still pending", async () => {
  const disk = storage();
  const journal = createQueryTaskJournal(disk);
  await journal.claim("b".repeat(64));
  const obsolete = journal.claim("b".repeat(64));
  const clearing = journal.clear();
  await expect(obsolete).rejects.toThrow("session changed");
  await clearing;
  expect(await disk.read()).toEqual([]);
});
it("expires completed queries after thirty minutes but retains unresolved dispatch keys", async () => {
  const disk = storage();
  const clock = vi.spyOn(Date, "now").mockReturnValue(10_000);
  try {
    const journal = createQueryTaskJournal(disk);
    const complete = await journal.claim("c".repeat(64));
    const pending = await journal.claim("d".repeat(64));
    await journal.complete(complete.key);
    clock.mockReturnValue(1_811_000);
    expect((await journal.claim(complete.key)).requestKey).not.toBe(complete.requestKey);
    expect((await journal.claim(pending.key)).requestKey).toBe(pending.requestKey);
  } finally {
    clock.mockRestore();
  }
});
