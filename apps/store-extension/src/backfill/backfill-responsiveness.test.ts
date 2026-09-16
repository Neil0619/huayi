import { expect, it, vi } from "vitest";
import { discoverBackfill } from "@huayi/store-domain";
import { createBackfillAuthority } from "./backfill-authority.js";
import { createBackfillRuntime } from "./backfill-runtime.js";
import { initialBackfillStorage } from "./backfill-vault.js";

function harness() {
  let saved = initialBackfillStorage();
  saved.localEnabled = true;
  discoverBackfill(saved.local, ["apple"], "local", new Date().toISOString());
  let finishPage: () => void = () => undefined;
  const page = new Promise<[]>((resolve) => {
    finishPage = () => resolve([]);
  });
  const listWords = vi.fn(() => page);
  let tail = Promise.resolve();
  const authority = createBackfillAuthority({
    vault: {
      read: async () => structuredClone(saved),
      write: async (state) => {
        saved = structuredClone(state);
      },
    },
    session: { readSession: async () => null },
    api: null,
    lock: (operation) => {
      const result = tail.then(operation);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  });
  const openTab = vi.fn(async () => 7);
  const runtime = createBackfillRuntime({
    authority,
    runtimeId: "extension",
    discovery: {
      lexicon: { snapshot: async () => [] },
      eudic: { listWords },
      allowEudic: async () => true,
    },
    allowPage: async () => true,
    grantConsent: async () => undefined,
    openTab,
    activateTab: async () => undefined,
    setBadge: async () => undefined,
    scheduleMore: () => undefined,
  });
  const sender = { id: "extension", url: "chrome-extension://extension/popup.html" };
  return { runtime, sender, listWords, finishPage, openTab };
}

it("returns saved counts while an Eudic page holds the serialized scan lock", async () => {
  const h = harness();
  const scan = h.runtime.refresh();
  await vi.waitFor(() => expect(h.listWords).toHaveBeenCalledOnce());
  let result: unknown;
  const reading = h.runtime.handle({ type: "store/backfill-status" }, h.sender).then((value) => {
    result = value;
  });
  try {
    await vi.waitFor(() => expect(result).toMatchObject({ status: { pendingCount: 1 } }), {
      timeout: 200,
    });
    expect(h.listWords).toHaveBeenCalledOnce();
  } finally {
    h.finishPage();
    await Promise.all([scan, reading]);
  }
});

it("opens the existing Shanbay destination before a slow scan finishes", async () => {
  const h = harness();
  const scan = h.runtime.refresh();
  await vi.waitFor(() => expect(h.listWords).toHaveBeenCalledOnce());
  const opening = h.runtime.handle(
    { type: "store/backfill-open", expectedScope: "local" },
    h.sender,
  );
  try {
    await vi.waitFor(() => expect(h.openTab).toHaveBeenCalledOnce(), { timeout: 200 });
    expect(h.listWords).toHaveBeenCalledOnce();
  } finally {
    h.finishPage();
    await Promise.all([scan, opening]);
  }
});
