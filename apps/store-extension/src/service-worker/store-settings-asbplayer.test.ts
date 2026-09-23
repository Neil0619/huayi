import { describe, expect, it, vi } from "vitest";

import { createChromeStoreSettings } from "./store-settings.js";

const shortcut = { alt: true, code: "KeyT", ctrl: false, meta: false, shift: false };
const consent = { grantedAt: "2026-09-23T00:00:00.000Z", version: 1 };
function legacy(version: number): Record<string, unknown> {
  const value: Record<string, unknown> = {
    schemaVersion: version,
    networkConsent: consent,
    providerId: "deepseek",
  };
  if (version >= 2)
    value.recipientAccess = {
      eudic: { consent, enabled: true },
      shanbay: { consent: null, enabled: false },
    };
  if (version >= 3) value.youtubeMode = "disabled";
  if (version >= 4) value.globallyEnabled = false;
  if (version === 4) value.disabledHosts = ["example.com"];
  if (version >= 5)
    Object.assign(value, {
      defaultAction: "ask",
      youtubeShortcut: shortcut,
      sitePolicy: {
        defaultAction: "block",
        rules: [{ hostname: "app.asbplayer.dev", includeSubdomains: false, action: "allow" }],
      },
    });
  if (version >= 6) value.overlayTheme = "parchment";
  return value;
}
function setup(value?: unknown) {
  let stored = value;
  const storage = {
    get: vi.fn(async () => ({ "huayi.store.settings": structuredClone(stored) })),
    set: vi.fn(async (values: Record<string, unknown>) => {
      stored = structuredClone(values["huayi.store.settings"]);
    }),
    setAccessLevel: vi.fn(async () => undefined),
  };
  return { storage, settings: createChromeStoreSettings(storage), read: () => stored };
}
describe("asbplayer settings migration", () => {
  it.each([1, 2, 3, 4, 5, 6])(
    "migrates v%i once and preserves existing preferences",
    async (version) => {
      const old = legacy(version);
      const { settings, storage, read } = setup(old);
      const migrated = await settings.get();
      expect(migrated).toMatchObject({
        schemaVersion: 7,
        asbplayerMode: "english",
        asbplayerShortcut: version >= 5 ? shortcut : null,
        providerId: "deepseek",
        networkConsent: consent,
      });
      for (const [key, value] of Object.entries(old)) {
        if (key !== "schemaVersion" && key !== "disabledHosts")
          expect(Reflect.get(migrated, key)).toEqual(value);
      }
      expect(read()).toEqual(migrated);
      await settings.get();
      expect(storage.set).toHaveBeenCalledOnce();
    },
  );
  it.each([1, 2, 3, 4, 5, 6])(
    "rejects failed v%i persistence and retains original data",
    async (version) => {
      const old = legacy(version);
      const { settings, storage, read } = setup(old);
      storage.set.mockRejectedValueOnce(new Error("storage unavailable"));
      await expect(settings.get()).rejects.toThrow("storage unavailable");
      expect(read()).toEqual(old);
      await expect(settings.get()).resolves.toMatchObject({ schemaVersion: 7 });
    },
  );
  it("defaults new installs and keeps later changes independent", async () => {
    const { settings } = setup();
    await expect(settings.get()).resolves.toMatchObject({
      asbplayerMode: "english",
      asbplayerShortcut: null,
    });
    await settings.setAsbplayerMode("bilingual");
    await settings.setAsbplayerShortcut(shortcut);
    await settings.setYoutubeMode("disabled");
    await settings.setYoutubeShortcut(null);
    await expect(settings.get()).resolves.toMatchObject({
      asbplayerMode: "bilingual",
      asbplayerShortcut: shortcut,
      youtubeMode: "disabled",
      youtubeShortcut: null,
    });
  });
});
