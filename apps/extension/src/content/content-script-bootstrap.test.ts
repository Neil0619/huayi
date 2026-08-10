import { describe, expect, it, vi } from "vitest";

import { DEFAULT_EXTENSION_SETTINGS } from "../settings/settings-domain.js";
import { SETTINGS_STORAGE_KEY, SettingsStore } from "../settings/settings-store.js";
import { bootstrapSettingsDrivenContent } from "./content-script-bootstrap.js";

function createDeferred<Value>(): {
  promise: Promise<Value>;
  reject(reason?: unknown): void;
  resolve(value: Value): void;
} {
  let rejectPromise: (reason?: unknown) => void = () => undefined;
  let resolvePromise: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });
  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

function createInstance() {
  return { destroy: vi.fn(), updateSettings: vi.fn() };
}

describe("bootstrapSettingsDrivenContent", () => {
  it("does not initialize while settings are pending or after the initial read fails", async () => {
    const settingsRead = createDeferred<Record<string, unknown>>();
    const store = new SettingsStore({
      area: { get: () => settingsRead.promise, set: vi.fn() },
      changes: { addListener: vi.fn(), removeListener: vi.fn() },
    });
    const initialize = vi.fn(createInstance);

    const bootstrapPromise = bootstrapSettingsDrivenContent(store, initialize);
    expect(initialize).not.toHaveBeenCalled();
    settingsRead.reject(new Error("storage unavailable"));
    const bootstrap = await bootstrapPromise;

    expect(initialize).not.toHaveBeenCalled();
    bootstrap.destroy();
  });

  it("keeps a newer storage change when the initial read resolves later", async () => {
    const settingsRead = createDeferred<Record<string, unknown>>();
    let notifyStorageChange:
      ((changes: Record<string, { newValue?: unknown }>, areaName: string) => void) | undefined;
    const store = new SettingsStore({
      area: { get: () => settingsRead.promise, set: vi.fn() },
      changes: {
        addListener: (listener) => {
          notifyStorageChange = listener;
        },
        removeListener: vi.fn(),
      },
    });
    const blockedSettings = { ...DEFAULT_EXTENSION_SETTINGS, enabled: false };
    const initialize = vi.fn(createInstance);

    const bootstrapPromise = bootstrapSettingsDrivenContent(store, initialize);
    notifyStorageChange?.({ [SETTINGS_STORAGE_KEY]: { newValue: blockedSettings } }, "local");
    settingsRead.resolve({});
    const bootstrap = await bootstrapPromise;

    expect(initialize).toHaveBeenCalledOnce();
    expect(initialize).toHaveBeenCalledWith(blockedSettings);
    bootstrap.destroy();
  });

  it("initializes from a successful read and continues applying settings changes", async () => {
    let notifyStorageChange:
      ((changes: Record<string, { newValue?: unknown }>, areaName: string) => void) | undefined;
    const store = new SettingsStore({
      area: {
        get: async () => ({ [SETTINGS_STORAGE_KEY]: DEFAULT_EXTENSION_SETTINGS }),
        set: vi.fn(),
      },
      changes: {
        addListener: (listener) => {
          notifyStorageChange = listener;
        },
        removeListener: vi.fn(),
      },
    });
    const instance = createInstance();
    const initialize = vi.fn(() => instance);
    const bootstrap = await bootstrapSettingsDrivenContent(store, initialize);

    expect(initialize).toHaveBeenCalledWith(DEFAULT_EXTENSION_SETTINGS);
    const updatedSettings = { ...DEFAULT_EXTENSION_SETTINGS, defaultAction: "translate" as const };
    notifyStorageChange?.({ [SETTINGS_STORAGE_KEY]: { newValue: updatedSettings } }, "local");
    expect(instance.updateSettings).toHaveBeenCalledWith(updatedSettings);
    bootstrap.destroy();
  });
});
