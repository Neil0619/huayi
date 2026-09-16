import { expect, it, vi } from "vitest";
import { discoverBackfill } from "@huayi/store-domain";
import { createBackfillAuthority } from "./backfill-authority.js";
import { createBackfillRuntime } from "./backfill-runtime.js";
import { backfillStorageSchema, initialBackfillStorage } from "./backfill-vault.js";
import {
  backfillPageReviewResponseSchema,
  backfillPageResponseSchema,
} from "./backfill-messages.js";

const sender = {
  id: "extension",
  url: "https://web.shanbay.com/wordsweb/#/collection",
  frameId: 0,
  tab: { id: 1 },
  documentId: "document-a",
};
const popup = { id: "extension", url: "chrome-extension://extension/popup.html" };
const review = { type: "store/backfill-page-review" };
function harness(count = 2) {
  let saved = initialBackfillStorage();
  saved.localEnabled = true;
  const words = Array.from(
    { length: count },
    (_, i) =>
      `word${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`,
  );
  discoverBackfill(saved.local, words, "local", new Date().toISOString());
  for (const source of Object.values(saved.local.sources)) source.state = "unresolved";
  const allowPage = vi.fn(async () => true);
  const activateTab = vi.fn<(tabId: number, view?: "review") => Promise<void>>(
    async () => undefined,
  );
  const authority = createBackfillAuthority({
    vault: {
      read: async () => backfillStorageSchema.parse(saved),
      write: async (value) => {
        saved = backfillStorageSchema.parse(value);
      },
    },
    session: { readSession: async () => null },
    api: null,
    lock: async (operation) => operation(),
  });
  const runtime = createBackfillRuntime({
    authority,
    runtimeId: "extension",
    allowPage,
    activateTab,
    discovery: {
      lexicon: { snapshot: async () => [] },
      eudic: { listWords: async () => [] },
      allowEudic: async () => false,
    },
    grantConsent: async () => undefined,
    openTab: async () => 1,
    setBadge: async () => undefined,
    scheduleMore: () => undefined,
  });
  const open = (view?: "review") =>
    runtime.handle(
      { type: "store/backfill-open", expectedScope: "local", ...(view ? { view } : {}) },
      popup,
    );
  const read = async (cursorAlias?: string) =>
    backfillPageReviewResponseSchema.parse(
      await runtime.handle({ ...review, ...(cursorAlias ? { cursorAlias } : {}) }, sender),
    );
  return { runtime, open, read, saved: () => saved, allowPage, activateTab };
}

it("opens review without claiming and consumes the persisted startup request once", async () => {
  const h = harness();
  await h.open("review");
  expect(h.activateTab).toHaveBeenCalledWith(1, "review");
  expect(h.saved().page?.reviewRequested).toBe(true);
  const ready = await h.runtime.handle({ type: "store/backfill-page-ready" }, sender);
  expect(ready).toEqual({ accepted: true, batch: null, review: true });
  expect(h.saved().local.batches).toEqual([]);
  expect(h.saved().page?.reviewRequested).toBe(false);
  expect(backfillPageResponseSchema.parse({ accepted: true, batch: null })).toEqual({
    accepted: true,
    batch: null,
  });
});

it("allows explicit review activation before ready and clears review intent for continue", async () => {
  const h = harness();
  await h.open("review");
  const result = await h.read();
  expect(result.items).toHaveLength(2);
  expect(h.saved().page?.documentId).toBe(sender.documentId);
  expect(h.saved().page?.reviewRequested).toBe(false);
  expect(h.saved().local.batches).toHaveLength(0);
  expect(await h.runtime.handle({ type: "store/backfill-page-ready" }, sender)).not.toHaveProperty(
    "review",
  );
  await h.open("review");
  await h.open();
  expect(h.saved().page?.reviewRequested).toBe(false);
});

it("paginates with opaque aliases and rejects aliases from a previous page or refresh", async () => {
  const h = harness(105);
  await h.open("review");
  const first = await h.read();
  expect(first.items).toHaveLength(100);
  expect(first.nextCursorAlias).toEqual(expect.any(String));
  expect(first).toMatchObject({ pendingCount: 0, unresolvedCount: 105, unknownCount: 0 });
  expect(JSON.stringify(first)).not.toMatch(/revision|scope|token|s:word/);
  const second = await h.read(first.nextCursorAlias ?? undefined);
  expect(second.items).toHaveLength(5);
  expect(second.nextCursorAlias).toBeNull();
  expect(
    await h.runtime.handle({ ...review, cursorAlias: first.nextCursorAlias }, sender),
  ).not.toMatchObject({ accepted: true });
  expect(
    await h.runtime.handle(
      { type: "store/backfill-page-review-discard", sourceAlias: first.items[0]?.alias },
      sender,
    ),
  ).not.toMatchObject({ accepted: true });
  const refreshed = await h.read();
  expect(refreshed.items[0]?.alias).not.toBe(first.items[0]?.alias);
});

it("persists consecutive alias-only changes, retires only used aliases, and never claims", async () => {
  const h = harness();
  await h.open("review");
  const first = await h.read();
  const source = first.items[0];
  if (!source) throw new Error("Missing source");
  const replace = {
    type: "store/backfill-page-review-replace",
    sourceAlias: source.alias,
    target: "apple",
  };
  expect(await h.runtime.handle(replace, sender)).toEqual({
    accepted: true,
    update: 1,
    pendingCount: 1,
    unresolvedCount: 1,
    unknownCount: 0,
  });
  expect(h.saved().local.sources[source.headword]).toMatchObject({
    target: "apple",
    state: "pending",
  });
  expect(await h.runtime.handle(replace, sender)).not.toMatchObject({ accepted: true });
  const remaining = first.items[1];
  if (!remaining) throw new Error("Missing source");
  expect(
    await h.runtime.handle(
      { type: "store/backfill-page-review-discard", sourceAlias: remaining.alias },
      sender,
    ),
  ).toEqual({ accepted: true, update: 2, pendingCount: 1, unresolvedCount: 0, unknownCount: 0 });
  expect(h.saved().local.sources[remaining.headword]?.state).toBe("discarded");
  expect(h.saved().local.batches).toHaveLength(0);
});

it("persists unknown batches on navigation and retries only the displayed batch alias", async () => {
  const h = harness();
  for (const source of Object.values(h.saved().local.sources)) source.state = "pending";
  await h.open();
  await h.runtime.handle({ type: "store/backfill-page-ready" }, sender);
  const oldToken = h.saved().page?.batch?.token;
  await h.open("review");
  const newSender = { ...sender, documentId: "document-b" };
  const result = backfillPageReviewResponseSchema.parse(await h.runtime.handle(review, newSender));
  expect(result.unknownBatches).toHaveLength(1);
  expect(result.unknownCount).toBe(2);
  expect(JSON.stringify(result)).not.toContain(oldToken);
  expect(h.saved().local.batches[0]?.state).toBe("unknown");
  expect(h.saved().page?.batch).toBeNull();
  const batchAlias = result.unknownBatches[0]?.alias;
  expect(
    await h.runtime.handle(
      { type: "store/backfill-page-review-retry-unknown", batchAlias },
      sender,
    ),
  ).not.toMatchObject({ accepted: true });
  expect(
    await h.runtime.handle(
      { type: "store/backfill-page-review-retry-unknown", batchAlias },
      newSender,
    ),
  ).toEqual({ accepted: true, update: 1, pendingCount: 2, unresolvedCount: 0, unknownCount: 0 });
  expect(h.saved().local.batches[0]?.state).toBe("resolved");
  expect(h.saved().local.sources.wordaa?.state).toBe("pending");
});

it.each([
  { id: "other" },
  { url: `${sender.url}?x` },
  { url: popup.url },
  { frameId: 1 },
  { tab: { id: 2 } },
  { tab: undefined },
  { documentId: "old-document" },
  { documentId: undefined },
])("isolates review reads and all mutations from invalid senders %j", async (changed) => {
  const h = harness();
  await h.open("review");
  const first = await h.read();
  const before = structuredClone(h.saved().local);
  for (const message of [
    review,
    {
      type: "store/backfill-page-review-replace",
      sourceAlias: first.items[0]?.alias,
      target: "apple",
    },
    { type: "store/backfill-page-review-discard", sourceAlias: first.items[0]?.alias },
    { type: "store/backfill-page-review-retry-unknown", batchAlias: crypto.randomUUID() },
    { type: "store/backfill-page-review-discard-unknown", batchAlias: crypto.randomUUID() },
    { type: "store/backfill-page-review-discard-all" },
  ]) {
    expect(await h.runtime.handle(message, { ...sender, ...changed })).not.toMatchObject({
      accepted: true,
    });
    expect(h.saved().local).toEqual(before);
  }
});

it("dismisses only a displayed unknown alias and prevents old retry aliases from reopening it", async () => {
  const h = harness();
  for (const source of Object.values(h.saved().local.sources)) source.state = "pending";
  await h.open();
  await h.runtime.handle({ type: "store/backfill-page-ready" }, sender);
  await h.open("review");
  const reviewSender = { ...sender, documentId: "document-b" };
  const view = backfillPageReviewResponseSchema.parse(await h.runtime.handle(review, reviewSender));
  const batchAlias = view.unknownBatches[0]?.alias;
  expect(
    await h.runtime.handle(
      { type: "store/backfill-page-review-discard-unknown", batchAlias },
      sender,
    ),
  ).not.toMatchObject({ accepted: true });
  expect(
    await h.runtime.handle(
      { type: "store/backfill-page-review-discard-unknown", batchAlias },
      reviewSender,
    ),
  ).toMatchObject({ accepted: true, unknownCount: 0, pendingCount: 0 });
  expect(
    await h.runtime.handle(
      { type: "store/backfill-page-review-retry-unknown", batchAlias },
      reviewSender,
    ),
  ).not.toMatchObject({ accepted: true });
  expect(
    Object.values(h.saved().local.targets).every((target) => target.confirmedAt === null),
  ).toBe(true);
  expect(h.saved().local.batches).toHaveLength(1);
});

it("rejects revoked permission, disabled state, account binding, and changed revision", async () => {
  const h = harness();
  await h.open("review");
  const first = await h.read();
  const discard = {
    type: "store/backfill-page-review-discard",
    sourceAlias: first.items[0]?.alias,
  };
  h.allowPage.mockResolvedValue(false);
  expect(await h.runtime.handle(discard, sender)).toBeUndefined();
  h.allowPage.mockResolvedValue(true);
  h.saved().localEnabled = false;
  expect(await h.runtime.handle(discard, sender)).not.toMatchObject({ accepted: true });
  h.saved().localEnabled = true;
  const page = h.saved().page;
  if (!page) throw new Error("Missing page");
  page.scope = "other-account";
  expect(await h.runtime.handle(discard, sender)).not.toMatchObject({ accepted: true });
  const restoredPage = h.saved().page;
  if (!restoredPage) throw new Error("Missing page");
  restoredPage.scope = "local";
  h.saved().localRevision += 1;
  expect(await h.runtime.handle(discard, sender)).not.toMatchObject({ accepted: true });
  expect(
    Object.values(h.saved().local.sources).every((source) => source.state === "unresolved"),
  ).toBe(true);
});

it("discards every unresolved page atomically while preserving pending targets", async () => {
  const h = harness(105);
  await h.open("review");
  const first = await h.read();
  expect(first.items).toHaveLength(100);
  const initial = h.saved().localRevision;
  expect(
    await h.runtime.handle({ type: "store/backfill-page-review-discard-all" }, sender),
  ).toEqual({ accepted: true, update: 1, pendingCount: 0, unresolvedCount: 0, unknownCount: 0 });
  expect(
    Object.values(h.saved().local.sources).filter((source) => source.state === "discarded"),
  ).toHaveLength(105);
  expect(h.saved().localRevision).toBe(initial + 1);
  expect(h.saved().local.batches).toHaveLength(0);
});
