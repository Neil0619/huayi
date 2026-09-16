import { afterEach, expect, it, vi } from "vitest";
import { initializePopupBackfill } from "./popup-backfill-visibility.js";
import { POPUP_BACKFILL_PREFERENCE_KEY } from "../page-ui/popup-backfill-preference.js";
import { deferred, preferenceStorage } from "../page-ui/popup-backfill-preference.test-support.js";

const view = {
  status: {
    scopeId: "account",
    enabled: true,
    dailyHour: 8,
    revision: 1,
    pendingCount: 7,
    unresolvedCount: 0,
    unknownCount: 0,
    lastCheckedAt: null,
  },
  shared: true,
  needsLocalMerge: false,
  checkError: null,
  incomplete: false,
  lastCheckedAt: null,
};
const panel = () => document.querySelector("[data-backfill-panel]");
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  document.body.replaceChildren();
});

it.each([undefined, null, false, "true", 1, {}, { enabled: true }])(
  "keeps missing, disabled or invalid preference %j hidden without backfill requests",
  async (value) => {
    const { storage } = preferenceStorage(value);
    const sendMessage = vi.fn(async () => view);
    initializePopupBackfill({ container: document.body, storage, sendMessage });
    expect(panel()).toBeNull();
    await vi.waitFor(() => expect(storage.local.get).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(panel()).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  },
);

it("shows only explicit true, persists across reopen and ignores unrelated storage changes", async () => {
  const { storage, emit, listeners } = preferenceStorage(true);
  const sendMessage = vi.fn(async () => view);
  const first = initializePopupBackfill({ container: document.body, storage, sendMessage });
  await vi.waitFor(() => expect(panel()?.textContent).toContain("待回填 7"));
  emit(true);
  emit(false, "sync");
  emit(false, "local", "huayi.store.diagnostics.consent");
  expect(document.querySelectorAll("[data-backfill-panel]")).toHaveLength(1);
  expect(sendMessage).toHaveBeenCalledOnce();
  first.dispose();
  expect(panel()).toBeNull();
  expect(listeners.size).toBe(0);
  initializePopupBackfill({ container: document.body, storage, sendMessage });
  await vi.waitFor(() => expect(panel()?.textContent).toContain("待回填 7"));
  expect(sendMessage).toHaveBeenCalledTimes(2);
  expect(storage.local.set).not.toHaveBeenCalled();
});

it("discards stale preference reads after a newer disable event or page teardown", async () => {
  const { storage, emit, listeners } = preferenceStorage();
  const read = deferred<Record<string, unknown>>();
  storage.local.get.mockReturnValueOnce(read.promise);
  const sendMessage = vi.fn(async () => view);
  initializePopupBackfill({ container: document.body, storage, sendMessage });
  emit(false);
  read.resolve({ [POPUP_BACKFILL_PREFERENCE_KEY]: true });
  await read.promise;
  await Promise.resolve();
  expect(panel()).toBeNull();
  expect(sendMessage).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("pagehide"));
  expect(listeners.size).toBe(0);

  const late = deferred<Record<string, unknown>>();
  storage.local.get.mockReturnValueOnce(late.promise);
  initializePopupBackfill({ container: document.body, storage, sendMessage });
  window.dispatchEvent(new Event("pagehide"));
  late.resolve({ [POPUP_BACKFILL_PREFERENCE_KEY]: true });
  await late.promise;
  await Promise.resolve();
  expect(panel()).toBeNull();
  expect(sendMessage).not.toHaveBeenCalled();
});

it("removes only its card and subscriptions while pending status cannot resurrect it", async () => {
  const { storage, emit } = preferenceStorage(true);
  const status = deferred<unknown>();
  const sendMessage = vi.fn().mockReturnValueOnce(status.promise).mockResolvedValue(view);
  const accountListeners = new Set<() => void>();
  const progressListeners = new Set<() => void>();
  const subscribe = (set: Set<() => void>) => (callback: () => void) => {
    set.add(callback);
    return () => void set.delete(callback);
  };
  document.body.innerHTML = "<div data-normal-popup>normal popup</div>";
  initializePopupBackfill({
    container: document.body,
    storage,
    sendMessage,
    subscribe: subscribe(accountListeners),
    subscribeProgress: subscribe(progressListeners),
  });
  await vi.waitFor(() => expect(panel()).not.toBeNull());
  emit(false);
  expect(panel()).toBeNull();
  expect(accountListeners.size).toBe(0);
  expect(progressListeners.size).toBe(0);
  status.resolve(view);
  await status.promise;
  await Promise.resolve();
  expect(panel()).toBeNull();
  expect(document.querySelector("[data-normal-popup]")?.textContent).toBe("normal popup");
  emit(true);
  emit(true);
  await vi.waitFor(() => expect(panel()?.textContent).toContain("待回填 7"));
  expect(document.querySelectorAll("[data-backfill-panel]")).toHaveLength(1);
  expect(accountListeners.size).toBe(1);
  expect(progressListeners.size).toBe(1);
  expect(sendMessage).toHaveBeenCalledTimes(2);
  emit("true");
  expect(panel()).toBeNull();
});

it("reports preference read failure without loading backfill and recovers on a storage update", async () => {
  const { storage, emit } = preferenceStorage();
  storage.local.get.mockRejectedValueOnce(new Error("storage failed"));
  const sendMessage = vi.fn(async () => view);
  initializePopupBackfill({ container: document.body, storage, sendMessage });
  await vi.waitFor(() => expect(document.body.textContent).toContain("无法读取弹窗显示设置"));
  expect(panel()).toBeNull();
  expect(sendMessage).not.toHaveBeenCalled();
  emit(true);
  await vi.waitFor(() => expect(panel()?.textContent).toContain("待回填 7"));
  expect(document.body.textContent).not.toContain("无法读取弹窗显示设置");
});

it("ignores a stale read rejection after an enabling event", async () => {
  const { storage, emit } = preferenceStorage();
  const read = deferred<Record<string, unknown>>();
  storage.local.get.mockReturnValueOnce(read.promise);
  const sendMessage = vi.fn(async () => view);
  initializePopupBackfill({ container: document.body, storage, sendMessage });
  emit(true);
  read.reject(new Error("old read failed"));
  await vi.waitFor(() => expect(panel()?.textContent).toContain("待回填 7"));
  expect(document.body.textContent).not.toContain("无法读取弹窗显示设置");
  expect(sendMessage).toHaveBeenCalledOnce();
});
