import { describe, expect, it } from "vitest";

import { DEFAULT_EXTENSION_SETTINGS, parseStoredSettings } from "../settings/settings-domain.js";
import { SETTINGS_STORAGE_KEY, SettingsStore } from "../settings/settings-store.js";
import { SettingsCoordinator } from "./settings-coordinator.js";

describe("SettingsCoordinator", () => {
  it("serializes concurrent mutations against the latest stored snapshot", async () => {
    const values: Record<string, unknown> = {
      [SETTINGS_STORAGE_KEY]: DEFAULT_EXTENSION_SETTINGS,
    };
    const store = new SettingsStore({
      area: {
        get: async () => ({ ...values }),
        set: async (items) => {
          await Promise.resolve();
          Object.assign(values, items);
        },
      },
    });
    const coordinator = new SettingsCoordinator(store);
    await Promise.all([
      coordinator.mutate({ enabled: false, type: "set-enabled" }),
      coordinator.mutate({ action: "translate", type: "set-default-action" }),
    ]);
    expect(parseStoredSettings(values[SETTINGS_STORAGE_KEY])).toMatchObject({
      settings: { defaultAction: "translate", enabled: false },
      status: "valid",
    });
  });
});
