import { expect, it, vi } from "vitest";
import { createBackfillAuthority } from "./backfill-authority.js";
import { createBackfillRuntime } from "./backfill-runtime.js";
import { initialBackfillStorage } from "./backfill-vault.js";

function harness() {
  let state = initialBackfillStorage();
  state.localEnabled = true;
  let release: () => void = () => undefined;
  const pending = new Promise<[]>((resolve) => {
    release = () => resolve([]);
  });
  const listWords = vi.fn(() => pending);
  const snapshot = vi.fn(async () => [
    {
      id: "word",
      headword: "apple",
      contexts: [],
      createdAt: "2026-09-15T00:00:00Z",
      updatedAt: "2026-09-15T00:00:00Z",
    },
  ]);
  let tail = Promise.resolve();
  const authority = createBackfillAuthority({
    vault: {
      read: async () => structuredClone(state),
      write: async (value) => {
        state = structuredClone(value);
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
  const scheduleMore = vi.fn<() => Promise<void>>(async () => undefined);
  const options = {
    authority,
    runtimeId: "extension",
    discovery: { lexicon: { snapshot }, eudic: { listWords }, allowEudic: async () => true },
    allowPage: async () => true,
    grantConsent: async () => undefined,
    openTab: async () => 7,
    activateTab: async () => undefined,
    setBadge: async () => undefined,
    scheduleMore,
  };
  const runtime = createBackfillRuntime(options);
  const sender = { id: "extension", url: "chrome-extension://extension/popup.html" };
  return {
    runtime,
    listWords,
    snapshot,
    release,
    state: () => state,
    scheduleMore,
    restart: () => createBackfillRuntime(options),
    check: () => runtime.handle({ type: "store/backfill-check", expectedScope: "local" }, sender),
    status: () => runtime.handle({ type: "store/backfill-status" }, sender),
    disable: () =>
      runtime.handle(
        {
          type: "store/backfill-enable",
          expectedScope: "local",
          enabled: false,
          shareLocal: false,
        },
        sender,
      ),
  };
}
it("coalesces many refresh and manual requests while preserving immediate cached reads", async () => {
  const h = harness();
  const scan = h.runtime.refresh();
  await vi.waitFor(() => expect(h.listWords).toHaveBeenCalledOnce());
  try {
    const reads = await Promise.all(Array.from({ length: 15 }, () => h.status()));
    expect(reads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: expect.objectContaining({ pendingCount: 1 }) }),
      ]),
    );
    const checks = await Promise.all(Array.from({ length: 10 }, () => h.check()));
    expect(checks.every((value) => value && "checking" in value && value.checking)).toBe(true);
    expect(h.scheduleMore).toHaveBeenCalled();
    expect(h.listWords).toHaveBeenCalledOnce();
    expect(h.snapshot).toHaveBeenCalledOnce();
  } finally {
    h.release();
    await scan;
    await h.runtime.refresh();
  }
});

it("preserves a same-day forced Eudic check across an earlier source failure and restart", async () => {
  const h = harness();
  h.release();
  await h.runtime.refresh();
  expect(h.listWords).toHaveBeenCalledOnce();
  h.snapshot.mockRejectedValueOnce(new Error("local unavailable"));
  await h.check();
  await h.runtime.refresh();
  expect(h.state().localProgress.checkError).not.toBeNull();
  expect(h.state().localProgress.forceRequested).toBe(true);
  expect(await h.status()).toMatchObject({ checking: false, checkError: expect.any(String) });
  await h.restart().refresh();
  expect(h.listWords).toHaveBeenCalledTimes(2);
  expect(h.state().localProgress.forceRequested).toBe(false);
  expect(h.state().localProgress.checkError).toBeNull();
});

it("cancels a persisted forced check when disabled without scheduling endless continuations", async () => {
  const h = harness();
  h.release();
  await h.runtime.refresh();
  h.state().localProgress.forceRequested = true;
  await h.disable();
  expect(h.state().localProgress.forceRequested).toBe(false);
  h.scheduleMore.mockClear();
  await h.restart().refresh();
  await h.restart().refresh();
  expect(h.scheduleMore).not.toHaveBeenCalledWith(0.5);
  expect(h.listWords).toHaveBeenCalledOnce();
});
it("persists local discovery deduplication across background restarts", async () => {
  const h = harness();
  h.release();
  await h.runtime.refresh();
  const revision = h.state().localRevision;
  await h.restart().refresh(true);
  expect(h.state().localRevision).toBe(revision);
  expect(Object.keys(h.state().local.sources)).toEqual(["apple"]);
});
it("does not acknowledge a manual scan until the durable alarm is scheduled", async () => {
  const h = harness();
  h.release();
  let release: () => void = () => undefined;
  h.scheduleMore.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  let response: unknown;
  const checking = h.check().then((value) => {
    response = value;
  });
  await vi.waitFor(() => expect(h.scheduleMore).toHaveBeenCalled());
  expect(response).toBeUndefined();
  release();
  await checking;
  await h.runtime.refresh();
  expect(response).toMatchObject({ status: { enabled: true } });
});
it.each([true, false])(
  "preserves manual force requested during an in-flight scan (localOnly=%s)",
  async (localOnly) => {
    const h = harness();
    h.release();
    await h.runtime.refresh();
    let finishLocal: () => void = () => undefined;
    h.snapshot.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLocal = () => resolve([]);
        }),
    );
    const local = h.runtime.refresh(localOnly);
    await vi.waitFor(() => expect(h.snapshot).toHaveBeenCalledTimes(2));
    try {
      await h.check();
      expect(h.state().localProgress.forceRequested).toBe(true);
    } finally {
      finishLocal();
      await local;
    }
    await h.runtime.refresh();
    expect(h.listWords).toHaveBeenCalledTimes(2);
    await h.restart().refresh();
    expect(h.listWords).toHaveBeenCalledTimes(2);
    expect(h.state().localProgress.forceRequested).toBe(false);
  },
);
