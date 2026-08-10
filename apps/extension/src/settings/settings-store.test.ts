import { describe, expect, it, vi } from "vitest";

import { DEFAULT_EXTENSION_SETTINGS } from "./settings-domain.js";
import { SETTINGS_STORAGE_KEY, SettingsStore } from "./settings-store.js";

describe("SettingsStore", () => {
  it("reads defaults without writing and atomically replaces valid settings", async () => {
    const values: Record<string, unknown> = {};
    const area = {
      get: vi.fn(async () => ({ ...values })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(values, items);
      }),
    };
    const store = new SettingsStore({ area });

    expect(await store.read()).toEqual({
      settings: DEFAULT_EXTENSION_SETTINGS,
      status: "defaulted",
    });
    const updated = { ...DEFAULT_EXTENSION_SETTINGS, defaultAction: "translate" as const };
    await store.replace(updated);
    expect(area.set).toHaveBeenCalledWith({ [SETTINGS_STORAGE_KEY]: updated });
    expect((await store.read()).settings.defaultAction).toBe("translate");
  });

  it("rejects invalid writes and parses change notifications fail closed", () => {
    const listeners = new Set<
      (changes: Record<string, { newValue?: unknown }>, area: string) => void
    >();
    const store = new SettingsStore({
      area: { get: vi.fn(), set: vi.fn() },
      changes: {
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener),
      },
    });
    expect(() =>
      store.replace({ ...DEFAULT_EXTENSION_SETTINGS, enabled: "yes" } as never),
    ).toThrow();
    const received = vi.fn();
    const unsubscribe = store.subscribe(received);
    for (const listener of listeners) {
      listener(
        { [SETTINGS_STORAGE_KEY]: { newValue: { enabled: "yes", settingsVersion: 1 } } },
        "local",
      );
    }
    expect(received).toHaveBeenCalledWith(expect.objectContaining({ status: "invalid" }));
    unsubscribe();
    expect(listeners.size).toBe(0);
  });
});
