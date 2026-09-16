import { afterEach, describe, expect, it, vi } from "vitest";
import { shanbayBackfillCommandSchema } from "@huayi/cloud-contracts";
import {
  backfillBadge,
  discoverBackfillSources,
  nextBackfillMorning,
} from "./backfill-discovery.js";
import { initialBackfillProgress, initialBackfillStorage } from "./backfill-vault.js";
import type { BackfillContext } from "./backfill-authority.js";

function context() {
  const state = initialBackfillStorage();
  const status = {
    enabled: true,
    dailyHour: 8,
    revision: 1,
    scopeId: "account",
    pendingCount: 0,
    unresolvedCount: 0,
    unknownCount: 0,
    lastCheckedAt: null,
  };
  state.scopes.account = {
    status,
    progress: initialBackfillProgress(),
    adopted: true,
    localExcluded: [],
    adoptIndex: 0,
    adoptPhase: "evidence",
    pending: null,
  };
  const command = vi.fn(async (command: Parameters<BackfillContext["command"]>[0]) => {
    shanbayBackfillCommandSchema.parse(command);
    return { accepted: true, batch: null, status, nextCursor: null };
  });
  const context: BackfillContext = {
    state,
    scope: "account",
    identity: "test-session",
    shared: true,
    progress: state.scopes.account.progress,
    command,
    status: () => status,
    persist: vi.fn(async () => undefined),
    adopt: async () => undefined,
    assertCurrent: async () => undefined,
    unresolved: async () => ({ items: [], unknownBatches: [], revision: 1, nextCursor: null }),
  };
  return {
    context,
    command,
    authority: {
      run: async <T>(operation: (context: BackfillContext) => Promise<T>) => operation(context),
    },
  };
}
afterEach(() => vi.useRealTimers());
describe("Backfill discovery", () => {
  it("uploads valid local/Eudic headwords even when a source page includes phrases", async () => {
    const h = context();
    const entry = (headword: string) => ({
      id: headword,
      headword,
      contexts: [],
      createdAt: "2026-09-15T00:00:00Z",
      updatedAt: "2026-09-15T00:00:00Z",
    });
    await discoverBackfillSources(h.authority, {
      lexicon: { snapshot: async () => [entry("Apple"), entry("take off")] },
      eudic: {
        listWords: async () => [
          { headword: "river", addedAt: "2026-09-15T00:00:00Z" },
          { headword: "look up", addedAt: "2026-09-15T00:00:00Z" },
        ],
      },
      allowEudic: async () => true,
    });
    expect(h.command.mock.calls.map((call) => call[0])).toEqual([
      { action: "discover", origin: "local", headwords: ["apple"] },
      { action: "reconcile", cursor: null },
      { action: "discover", origin: "eudic", headwords: ["river"] },
    ]);
  });
  it("persists each Eudic page, resumes the next page and marks the cap incomplete", async () => {
    const h = context();
    h.context.progress.eudicPage = 49;
    const listWords = vi.fn<
      (page: number, signal: AbortSignal) => Promise<{ headword: string; addedAt: string }[]>
    >(async () =>
      Array.from({ length: 100 }, () => ({ headword: "apple", addedAt: "2026-09-15T00:00:00Z" })),
    );
    const deps = {
      lexicon: { snapshot: async () => [] },
      eudic: { listWords },
      allowEudic: async () => true,
    };
    expect(await discoverBackfillSources(h.authority, deps)).toBe(true);
    expect(h.context.progress.eudicPage).toBe(50);
    expect(await discoverBackfillSources(h.authority, deps)).toBe(false);
    expect(listWords.mock.calls.map((call) => call[0])).toEqual([49, 50]);
    expect(h.context.progress).toMatchObject({
      eudicPage: null,
      incomplete: true,
      checkError: null,
    });
  });
  it("anchors the next alarm to local 08:00 and caps attention badges", () => {
    const before = new Date(2026, 8, 15, 7, 59);
    const after = new Date(2026, 8, 15, 8, 1);
    expect(new Date(nextBackfillMorning(before)).getHours()).toBe(8);
    expect(new Date(nextBackfillMorning(after)).getDate()).toBe(16);
    expect(backfillBadge(1000, true)).toBe("999+");
    expect(backfillBadge(0, true)).toBe("!");
    expect(backfillBadge(0, false)).toBe("");
  });
});
