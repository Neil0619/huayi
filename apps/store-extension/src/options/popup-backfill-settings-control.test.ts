import { afterEach, expect, it, vi } from "vitest";
import { initializePopupBackfillSettings } from "./popup-backfill-settings-control.js";
import { POPUP_BACKFILL_PREFERENCE_KEY } from "../page-ui/popup-backfill-preference.js";
import { deferred, preferenceStorage } from "../page-ui/popup-backfill-preference.test-support.js";
import { createHarness, element, renderPage } from "./options-page.test-support.js";

const input = () => element<HTMLInputElement>("[data-popup-backfill-visible]");
const status = () => element("[data-popup-backfill-status]");
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  document.body.replaceChildren();
});

it("saves an isolated plugin preference and restores it on reopen without touching core settings", async () => {
  renderPage();
  const { storage, values } = preferenceStorage();
  const before = { ...values };
  initializePopupBackfillSettings(document, storage);
  await vi.waitFor(() => expect(input().disabled).toBe(false));
  expect(input().checked).toBe(false);
  input().click();
  await vi.waitFor(() => expect(status().textContent).toContain("已显示"));
  expect(values).toEqual({ ...before, [POPUP_BACKFILL_PREFERENCE_KEY]: true });
  expect(storage.local.set).toHaveBeenCalledWith({ [POPUP_BACKFILL_PREFERENCE_KEY]: true });
  window.dispatchEvent(new Event("pagehide"));
  renderPage();
  initializePopupBackfillSettings(document, storage);
  await vi.waitFor(() => expect(input().checked).toBe(true));
  input().click();
  await vi.waitFor(() => expect(status().textContent).toContain("已隐藏"));
  expect(values[POPUP_BACKFILL_PREFERENCE_KEY]).toBe(false);
});

it("keeps the independent control disabled during load and save despite core settings renders", async () => {
  renderPage();
  const { storage } = preferenceStorage();
  const read = deferred<Record<string, unknown>>();
  storage.local.get.mockReturnValueOnce(read.promise);
  initializePopupBackfillSettings(document, storage);
  const { page } = createHarness();
  await page.initialize();
  expect(input().disabled).toBe(true);
  read.resolve({});
  await vi.waitFor(() => expect(input().disabled).toBe(false));
  const save = deferred<undefined>();
  storage.local.set.mockReturnValueOnce(save.promise);
  input().click();
  const provider = element<HTMLSelectElement>("[data-provider]");
  provider.value = "deepseek";
  provider.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(document.body.getAttribute("aria-busy")).toBe("false"));
  expect(input().disabled).toBe(true);
  save.resolve(undefined);
  await vi.waitFor(() => expect(input().disabled).toBe(false));
});

it("restores persisted value after a failed save and reports the error", async () => {
  renderPage();
  const { storage } = preferenceStorage(true);
  storage.local.set.mockRejectedValueOnce(new Error("full"));
  initializePopupBackfillSettings(document, storage);
  await vi.waitFor(() => expect(input().checked).toBe(true));
  input().click();
  await vi.waitFor(() => expect(status().textContent).toContain("保存失败"));
  expect(input().checked).toBe(true);
  expect(input().disabled).toBe(false);
});

it("reports read failures without allowing an unknown state to be saved", async () => {
  renderPage();
  const { storage, emit } = preferenceStorage();
  storage.local.get.mockRejectedValueOnce(new Error("unavailable"));
  initializePopupBackfillSettings(document, storage);
  await vi.waitFor(() => expect(status().textContent).toContain("无法读取"));
  expect(input().disabled).toBe(true);
  input().click();
  expect(storage.local.set).not.toHaveBeenCalled();
  emit(true);
  expect(input().checked).toBe(true);
  expect(input().disabled).toBe(false);
});

it("keeps failed saves honest if reconciliation also fails, then recovers on newer events", async () => {
  renderPage();
  const { storage, emit } = preferenceStorage(true);
  initializePopupBackfillSettings(document, storage);
  await vi.waitFor(() => expect(input().disabled).toBe(false));
  storage.local.set.mockRejectedValueOnce(new Error("full"));
  storage.local.get.mockRejectedValueOnce(new Error("unavailable"));
  input().click();
  await vi.waitFor(() => expect(status().textContent).toContain("无法确认"));
  expect(input().disabled).toBe(true);
  expect(input().checked).toBe(true);
  emit(false);
  expect(input().checked).toBe(false);
  expect(input().disabled).toBe(false);
});

it("uses the latest storage event over stale load and post-save reads and disposes on pagehide", async () => {
  renderPage();
  const { storage, emit, listeners } = preferenceStorage();
  const read = deferred<Record<string, unknown>>();
  storage.local.get.mockReturnValueOnce(read.promise);
  initializePopupBackfillSettings(document, storage);
  emit(true);
  read.resolve({ [POPUP_BACKFILL_PREFERENCE_KEY]: false });
  await read.promise;
  expect(input().checked).toBe(true);
  const savedRead = deferred<Record<string, unknown>>();
  storage.local.get.mockReturnValueOnce(savedRead.promise);
  input().click();
  await vi.waitFor(() => expect(storage.local.get).toHaveBeenCalledTimes(2));
  emit(true);
  savedRead.resolve({ [POPUP_BACKFILL_PREFERENCE_KEY]: false });
  await vi.waitFor(() => expect(input().disabled).toBe(false));
  expect(input().checked).toBe(true);
  window.dispatchEvent(new Event("pagehide"));
  expect(listeners.size).toBe(0);
  emit(false);
  expect(input().checked).toBe(true);
});

it("places the switch only under external dictionaries, with the Options backfill mount unchanged", async () => {
  renderPage();
  const { storage } = preferenceStorage();
  initializePopupBackfillSettings(document, storage);
  await createHarness().page.initialize();
  for (const category of [
    "common",
    "sites",
    "credentials",
    "wordbooks",
    "lexicon",
    "common",
    "wordbooks",
  ]) {
    element<HTMLButtonElement>(`[data-settings-nav="${category}"]`).click();
    expect(input().closest("[hidden]") === null).toBe(category === "wordbooks");
    expect(element("[data-options-backfill-mount]").closest("[hidden]") === null).toBe(
      category === "wordbooks",
    );
  }
  expect(input().closest('[data-recipient-card="shanbay"]')).not.toBeNull();
  await vi.waitFor(() => expect(input().disabled).toBe(false));
  expect(element<HTMLInputElement>('[data-recipient-enabled="shanbay"]').disabled).toBe(true);
});

it("does not report success when a completed save cannot be read back", async () => {
  renderPage();
  const { storage } = preferenceStorage(false);
  initializePopupBackfillSettings(document, storage);
  await vi.waitFor(() => expect(input().disabled).toBe(false));
  storage.local.get.mockRejectedValueOnce(new Error("unavailable"));
  input().click();
  await vi.waitFor(() => expect(status().textContent).toContain("无法读取"));
  expect(status().textContent).not.toContain("已显示");
  expect(input().disabled).toBe(true);
});

it("stops reconciliation and UI updates if the settings page closes during a save", async () => {
  renderPage();
  const { storage, listeners } = preferenceStorage(false);
  initializePopupBackfillSettings(document, storage);
  await vi.waitFor(() => expect(input().disabled).toBe(false));
  const save = deferred<undefined>();
  storage.local.set.mockReturnValueOnce(save.promise);
  input().click();
  window.dispatchEvent(new Event("pagehide"));
  const previous = status().textContent;
  save.resolve(undefined);
  await save.promise;
  await Promise.resolve();
  expect(listeners.size).toBe(0);
  expect(storage.local.get).toHaveBeenCalledOnce();
  expect(status().textContent).toBe(previous);
});
