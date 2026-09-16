import { expect, it, vi } from "vitest";
import { discoverBackfill } from "@huayi/store-domain";
import { createBackfillAuthority } from "./backfill-authority.js";
import { createBackfillRuntime } from "./backfill-runtime.js";
import { initialBackfillStorage } from "./backfill-vault.js";
import { backfillPageResponseSchema } from "./backfill-messages.js";

function harness() {
  const state = initialBackfillStorage();
  state.localEnabled = true;
  discoverBackfill(state.local, ["apple", "river"], "local", new Date().toISOString());
  const authority = createBackfillAuthority({
    vault: { read: async () => state, write: async () => undefined },
    session: { readSession: async () => null },
    api: null,
    lock: async (operation) => operation(),
  });
  const badge = vi.fn<(text: string) => Promise<void>>(async () => undefined);
  const runtime = createBackfillRuntime({
    authority,
    discovery: {
      lexicon: { snapshot: async () => [] },
      eudic: {
        listWords: async () => {
          throw new Error("offline");
        },
      },
      allowEudic: async () => true,
    },
    runtimeId: "extension",
    allowPage: async () => true,
    grantConsent: async () => undefined,
    openTab: async () => 1,
    activateTab: async () => undefined,
    setBadge: badge,
    scheduleMore: () => undefined,
  });
  return { state, runtime, badge };
}

it.each([
  { url: "chrome-extension://extension/options.html", frameId: 0, tab: { id: 42 } },
  { url: "chrome-extension://extension/options.html" },
  { url: "chrome-extension://extension/popup.html" },
  { url: "chrome-extension://extension/popup.html", frameId: 0 },
])("accepts a trusted settings sender $url with its Chrome tab metadata", async (sender) => {
  const h = harness();
  const result = await h.runtime.handle(
    { type: "store/backfill-enable", expectedScope: "local", enabled: false, shareLocal: false },
    { id: "extension", ...sender },
  );
  expect(result).toMatchObject({ status: { enabled: false, pendingCount: 2 } });
  expect(h.state.localEnabled).toBe(false);
});

it.each([
  { url: "chrome-extension://extension/other.html" },
  { url: "chrome-extension://extension/sub/options.html" },
  { url: "chrome-extension://extension/options.html?source=page" },
  { url: "chrome-extension://extension/options.html#wordbooks" },
  { url: "chrome-extension://extension/popup.html?source=page" },
  { url: "chrome-extension://extension/popup.html#fragment" },
  { url: "chrome-extension://other/options.html" },
  { url: "https://example.com/options.html" },
  { url: "chrome-extension://extension/options.html", id: "other" },
  { url: "chrome-extension://extension/options.html", frameId: 1, tab: { id: 42 } },
  { url: "chrome-extension://extension/popup.html", frameId: 1 },
  { url: "chrome-extension://extension/options.html", frameId: -1 },
  {},
])("rejects untrusted settings senders without changing backfill state: %j", async (sender) => {
  const h = harness();
  const result = await h.runtime.handle(
    { type: "store/backfill-enable", expectedScope: "local", enabled: false, shareLocal: false },
    { id: "extension", ...sender },
  );
  expect(result).toBeUndefined();
  expect(h.state.localEnabled).toBe(true);
  expect(h.badge).not.toHaveBeenCalled();
});

it("keeps a pending count and exposes a saved check error after discovery fails", async () => {
  const h = harness();
  await h.runtime.refresh();
  expect(h.badge).toHaveBeenLastCalledWith("2");
  const result = await h.runtime.handle(
    { type: "store/backfill-status" },
    {
      id: "extension",
      url: "chrome-extension://extension/popup.html",
    },
  );
  expect(result).toMatchObject({ status: { pendingCount: 2 }, checkError: expect.any(String) });
  expect(h.badge).toHaveBeenLastCalledWith("2");
  await h.runtime.handle(
    { type: "store/backfill-check", expectedScope: "local" },
    {
      id: "extension",
      url: "chrome-extension://extension/popup.html",
    },
  );
  expect(h.badge).toHaveBeenLastCalledWith("2");
});
it("rejects nested frames on the otherwise authorized Shanbay page", async () => {
  const h = harness();
  const result = await h.runtime.handle(
    { type: "store/backfill-page-ready" },
    {
      id: "extension",
      frameId: 7,
      tab: { id: 1 },
      url: "https://web.shanbay.com/wordsweb/#/collection",
    },
  );
  expect(result).toBeUndefined();
  expect(h.state.local.batches).toHaveLength(0);
});

it("preserves Shanbay tab, document, scope and alias checks after settings opens a batch", async () => {
  const h = harness();
  await h.runtime.handle(
    { type: "store/backfill-open", expectedScope: "local" },
    {
      id: "extension",
      url: "chrome-extension://extension/options.html",
      tab: { id: 42 },
      frameId: 0,
    },
  );
  const sender = {
    id: "extension",
    url: "https://web.shanbay.com/wordsweb/#/collection",
    frameId: 0,
    tab: { id: 1 },
    documentId: "current-document",
  };
  const ready = backfillPageResponseSchema.parse(
    await h.runtime.handle({ type: "store/backfill-page-ready" }, sender),
  );
  expect(ready.accepted).toBe(true);
  expect(ready.batch?.items.map((item) => item.headword)).toEqual(["apple", "river"]);
  if (!ready.batch) throw new Error("Expected a batch from the authorized Shanbay page.");
  const message = {
    type: "store/backfill-resolve",
    batchAlias: ready.batch.batchAlias,
    confirmedAliases: ready.batch.items.map((item) => item.alias),
    rejectedAliases: [],
  };
  const before = structuredClone(h.state.local);
  for (const changedSender of [
    { ...sender, tab: { id: 2 } },
    { ...sender, tab: undefined },
    { ...sender, documentId: "old-document" },
    { ...sender, frameId: 1 },
    { ...sender, url: "chrome-extension://extension/options.html" },
    { ...sender, id: "other" },
  ]) {
    expect(await h.runtime.handle(message, changedSender)).not.toMatchObject({ accepted: true });
    expect(h.state.local).toEqual(before);
  }
  for (const changedMessage of [
    { ...message, batchAlias: "00000000-0000-4000-8000-000000000001" },
    { ...message, confirmedAliases: ["00000000-0000-4000-8000-000000000002"] },
    { ...message, confirmedAliases: [] },
  ]) {
    expect(await h.runtime.handle(changedMessage, sender)).toEqual({
      accepted: false,
      batch: null,
    });
    expect(h.state.local).toEqual(before);
  }
  if (!h.state.page) throw new Error("Expected the active page to remain registered.");
  h.state.page.scope = "other-account";
  expect(await h.runtime.handle(message, sender)).toEqual({ accepted: false, batch: null });
  expect(h.state.local).toEqual(before);
  h.state.page.scope = "local";
  expect(await h.runtime.handle(message, sender)).toEqual({ accepted: true, batch: null });
  expect(h.state.page.batch).toBeNull();
});

it("retains a different-account baseline when re-enabling after new local words were saved", async () => {
  const state = initialBackfillStorage();
  state.migratedTo = "account-a";
  const status = {
    scopeId: "account-b",
    enabled: false,
    dailyHour: 8,
    revision: 0,
    pendingCount: 0,
    unresolvedCount: 0,
    unknownCount: 0,
    lastCheckedAt: null,
  };
  const discovered: string[] = [];
  const authority = createBackfillAuthority({
    vault: { read: async () => state, write: async () => undefined },
    session: {
      readSession: async () => ({
        token: "token-b",
        expiresAt: "2099-01-01T00:00:00Z",
        preferences: {
          cloudWordCopyMode: "disabled",
          extensionQueryModelMode: "platform",
          studyCaptureMode: "manual",
          revision: 1,
          updatedAt: "2026-09-15T00:00:00Z",
        },
      }),
    },
    api: {
      status: async () => status,
      unresolved: async () => ({ items: [], unknownBatches: [], nextCursor: null, revision: 0 }),
      command: async (_token, _key, command) => {
        void _token;
        void _key;
        if (command.action === "settings") status.enabled = command.enabled;
        if (command.action === "discover" && command.origin === "local")
          discovered.push(...command.headwords);
        return { status, accepted: true, batch: null, nextCursor: null };
      },
    },
    lock: async (operation) => operation(),
  });
  const words = ["oldword"];
  const runtime = createBackfillRuntime({
    authority,
    runtimeId: "extension",
    discovery: {
      lexicon: {
        snapshot: async () =>
          words.map((headword) => ({
            id: headword,
            headword,
            contexts: [],
            createdAt: "2026-09-15T00:00:00Z",
            updatedAt: "2026-09-15T00:00:00Z",
          })),
      },
      eudic: { listWords: async () => [] },
      allowEudic: async () => false,
    },
    allowPage: async () => true,
    grantConsent: async () => undefined,
    openTab: async () => 1,
    activateTab: async () => undefined,
    setBadge: async () => undefined,
    scheduleMore: () => undefined,
  });
  const sender = { id: "extension", url: "chrome-extension://extension/popup.html" };
  const enable = (enabled: boolean) =>
    runtime.handle(
      { type: "store/backfill-enable", expectedScope: "account-b", enabled, shareLocal: false },
      sender,
    );
  await enable(true);
  await runtime.refresh();
  expect(state.scopes["account-b"]?.localExcluded).toEqual(["oldword"]);
  await enable(false);
  words.push("newword");
  await enable(true);
  await runtime.refresh();
  expect(state.scopes["account-b"]?.localExcluded).toEqual(["oldword"]);
  expect(discovered).toContain("newword");
  expect(discovered).not.toContain("oldword");
});
