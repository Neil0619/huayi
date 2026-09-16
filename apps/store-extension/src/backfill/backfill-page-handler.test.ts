import { expect, it, vi } from "vitest";
import { handleBackfillPage } from "./backfill-page-handler.js";
import { initialBackfillStorage } from "./backfill-vault.js";
import type { BackfillContext } from "./backfill-authority.js";

it("rejects late aliases from an old document before touching the new document's batch", async () => {
  const state = initialBackfillStorage();
  const alias = "00000000-0000-4000-8000-000000000001";
  state.page = {
    scope: "local",
    tabId: 8,
    documentId: "new-document",
    batch: { token: "new-token", alias, items: [{ headword: "apple", alias }] },
  };
  const status = {
    scopeId: "local",
    enabled: true,
    dailyHour: 8,
    revision: 1,
    pendingCount: 1,
    unresolvedCount: 0,
    unknownCount: 0,
    lastCheckedAt: null,
  };
  const command = vi.fn(async () => ({ status, accepted: true, batch: null, nextCursor: null }));
  const context: BackfillContext = {
    state,
    scope: "local",
    identity: "local",
    shared: false,
    progress: state.localProgress,
    persist: async () => undefined,
    status: () => status,
    command,
    adopt: async () => undefined,
    assertCurrent: async () => undefined,
    unresolved: async () => ({ items: [], unknownBatches: [], nextCursor: null, revision: 1 }),
  };
  expect(
    await handleBackfillPage(
      context,
      { type: "store/backfill-unknown", batchAlias: "00000000-0000-4000-8000-000000000002" },
      { tab: { id: 8 }, documentId: "old-document" },
    ),
  ).toEqual({ accepted: false, batch: null });
  expect(command).not.toHaveBeenCalled();
  expect(state.page).toMatchObject({ documentId: "new-document", batch: { token: "new-token" } });
});
