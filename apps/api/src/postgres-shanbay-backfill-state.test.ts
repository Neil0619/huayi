import { expect, it, vi } from "vitest";
import { createBackfillState, discoverBackfill } from "@huayi/cloud-contracts";
import { saveBackfillState } from "./postgres-shanbay-backfill-state.js";

const now = "2026-09-16T08:00:00.000Z";
const words = Array.from(
  { length: 251 },
  (_, index) => `word${String.fromCharCode(97 + Math.floor(index / 26), 97 + (index % 26))}`,
);

it.each([
  { count: 51, sizes: [51] },
  { count: 251, sizes: [100, 100, 51] },
])(
  "writes $count changed records in bounded chunks instead of one query per word",
  async ({ count, sizes }) => {
    const before = createBackfillState();
    discoverBackfill(before, ["unchanged"], "local", now);
    const state = structuredClone(before);
    const changed = words.slice(0, count);
    discoverBackfill(state, changed, "local", now);
    const rows = vi
      .fn<(text: string, parameters?: readonly unknown[]) => Promise<never[]>>()
      .mockResolvedValue([]);
    await saveBackfillState({ rows }, "owner", before, state);
    for (const name of ["sources", "targets"] as const) {
      const writes = rows.mock.calls.filter(([sql]) =>
        sql.startsWith(`INSERT INTO shanbay_backfill_${name}`),
      );
      expect(writes).toHaveLength(sizes.length);
      const chunks = writes.map(
        ([, parameters]) => JSON.parse(String(parameters?.[1])) as unknown[],
      );
      expect(chunks.map((chunk) => chunk.length)).toEqual(sizes);
      expect(chunks.flat()).toEqual(
        changed.map((headword) => ({
          headword,
          record: state[name][headword],
        })),
      );
    }
  },
);

it.each(["sources", "targets", "batches"] as const)(
  "validates all %s records before emitting any write",
  async (field) => {
    const before = createBackfillState();
    const state = createBackfillState();
    discoverBackfill(state, words, "local", now);
    if (field === "batches")
      state.batches.push({
        token: "oversized",
        holder: "device",
        headwords: words,
        state: "resolved",
        expiresAt: now,
      });
    else {
      const key = words.at(-1) ?? "word";
      const record = state[field][key];
      if (!record) throw new Error("Expected the last record.");
      record.headword = "invalid headword";
    }
    const rows = vi.fn(async () => []);
    await expect(saveBackfillState({ rows }, "owner", before, state)).rejects.toThrow();
    expect(rows).not.toHaveBeenCalled();
  },
);
