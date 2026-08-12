import { STORE_SITE_RULE_LIMIT } from "@huayi/store-domain";
import { describe, expect, it, vi } from "vitest";

import { createChromeStoreSettings, type ChromeSettingsStorageArea } from "./store-settings.js";

function area(initial?: unknown): ChromeSettingsStorageArea & {
  readonly values: Map<string, unknown>;
} {
  const values = new Map<string, unknown>();
  if (initial !== undefined) values.set("huayi.store.settings", initial);
  return {
    values,
    get: vi.fn(async (key: string) => ({ [key]: values.get(key) })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) values.set(key, structuredClone(value));
    }),
    setAccessLevel: vi.fn(async () => undefined),
  };
}

describe("Chrome Store settings", () => {
  it("defaults to no consent and restricts storage to trusted contexts", async () => {
    const local = area();
    const settings = createChromeStoreSettings(local);

    await expect(settings.get()).resolves.toEqual({
      defaultAction: "ask",
      globallyEnabled: true,
      networkConsent: null,
      overlayTheme: "pearl",
      providerId: "openai",
      recipientAccess: {
        eudic: { consent: null, enabled: false },
        shanbay: { consent: null, enabled: false },
      },
      schemaVersion: 6,
      sitePolicy: { defaultAction: "allow", rules: [] },
      youtubeMode: "english",
      youtubeShortcut: null,
    });
    expect(local.setAccessLevel).toHaveBeenCalledOnce();
    expect(local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
  });

  it("persists an explicit consent receipt and fixed provider without losing either", async () => {
    const local = area();
    const settings = createChromeStoreSettings(local);

    await settings.setProvider("deepseek");
    await settings.grantNetworkConsent(new Date("2026-08-11T01:00:00.000Z"));

    await expect(settings.get()).resolves.toEqual({
      defaultAction: "ask",
      globallyEnabled: true,
      networkConsent: { grantedAt: "2026-08-11T01:00:00.000Z", version: 1 },
      overlayTheme: "pearl",
      providerId: "deepseek",
      recipientAccess: {
        eudic: { consent: null, enabled: false },
        shanbay: { consent: null, enabled: false },
      },
      schemaVersion: 6,
      sitePolicy: { defaultAction: "allow", rules: [] },
      youtubeMode: "english",
      youtubeShortcut: null,
    });
  });

  it("migrates v1 to disabled recipients and fails if the migration cannot persist", async () => {
    const local = area({ networkConsent: null, providerId: "deepseek", schemaVersion: 1 });
    const settings = createChromeStoreSettings(local);

    await expect(settings.get()).resolves.toMatchObject({
      providerId: "deepseek",
      recipientAccess: {
        eudic: { consent: null, enabled: false },
        shanbay: { consent: null, enabled: false },
      },
      schemaVersion: 6,
      youtubeMode: "english",
    });
    expect(local.set).toHaveBeenCalledOnce();

    const failing = area({ networkConsent: null, providerId: "openai", schemaVersion: 1 });
    vi.mocked(failing.set).mockRejectedValueOnce(new Error("disk full"));
    await expect(createChromeStoreSettings(failing).get()).rejects.toThrow("disk full");
  });

  it("migrates v2 to English YouTube mode and fails closed when persistence fails", async () => {
    const v2 = {
      networkConsent: null,
      providerId: "openai",
      recipientAccess: {
        eudic: { consent: null, enabled: false },
        shanbay: { consent: null, enabled: false },
      },
      schemaVersion: 2,
    };
    const local = area(v2);

    await expect(createChromeStoreSettings(local).get()).resolves.toMatchObject({
      schemaVersion: 6,
      youtubeMode: "english",
    });
    expect(local.set).toHaveBeenCalledOnce();

    const failing = area(v2);
    vi.mocked(failing.set).mockRejectedValueOnce(new Error("disk full"));
    await expect(createChromeStoreSettings(failing).get()).rejects.toThrow("disk full");
  });

  it("persists an explicit YouTube mode", async () => {
    const settings = createChromeStoreSettings(area());

    await settings.setYoutubeMode("bilingual");

    await expect(settings.get()).resolves.toMatchObject({ youtubeMode: "bilingual" });
  });

  it("migrates v5 to the pearl overlay and persists an explicit parchment preference", async () => {
    const local = area({
      defaultAction: "ask",
      globallyEnabled: true,
      networkConsent: null,
      providerId: "openai",
      recipientAccess: {
        eudic: { consent: null, enabled: false },
        shanbay: { consent: null, enabled: false },
      },
      schemaVersion: 5,
      sitePolicy: { defaultAction: "allow", rules: [] },
      youtubeMode: "english",
      youtubeShortcut: null,
    });
    const settings = createChromeStoreSettings(local);

    await expect(settings.get()).resolves.toMatchObject({
      overlayTheme: "pearl",
      schemaVersion: 6,
    });
    await settings.setOverlayTheme("parchment");
    await expect(settings.get()).resolves.toMatchObject({ overlayTheme: "parchment" });
  });

  it("upserts one exact site rule and keeps imported subdomain policy as the only source", async () => {
    const settings = createChromeStoreSettings(area());

    await settings.setSiteEnabled("z.example", false);
    await settings.setSiteEnabled("a.example", false);
    await settings.setSiteEnabled("z.example", true);
    await expect(settings.get()).resolves.toMatchObject({
      sitePolicy: {
        defaultAction: "allow",
        rules: [
          { action: "block", hostname: "a.example", includeSubdomains: false },
          { action: "allow", hostname: "z.example", includeSubdomains: false },
        ],
      },
    });
    await expect(settings.setSiteEnabled("UPPER.example", false)).rejects.toThrow();

    const bounded = area({
      defaultAction: "ask",
      globallyEnabled: true,
      networkConsent: null,
      overlayTheme: "pearl",
      providerId: "openai",
      recipientAccess: {
        eudic: { consent: null, enabled: false },
        shanbay: { consent: null, enabled: false },
      },
      schemaVersion: 6,
      sitePolicy: {
        defaultAction: "allow",
        rules: Array.from({ length: STORE_SITE_RULE_LIMIT }, (_, index) => ({
          action: "block",
          hostname: `h${String(index).padStart(3, "0")}.example`,
          includeSubdomains: false,
        })),
      },
      youtubeMode: "english",
      youtubeShortcut: null,
    });
    await expect(
      createChromeStoreSettings(bounded).setSiteEnabled("overflow.example", false),
    ).rejects.toThrow();
  });

  it("migrates v3 to an enabled empty site policy and fails closed if persistence fails", async () => {
    const v3 = {
      networkConsent: null,
      providerId: "openai",
      recipientAccess: {
        eudic: { consent: null, enabled: false },
        shanbay: { consent: null, enabled: false },
      },
      schemaVersion: 3,
      youtubeMode: "bilingual",
    };
    const local = area(v3);

    await expect(createChromeStoreSettings(local).get()).resolves.toMatchObject({
      globallyEnabled: true,
      schemaVersion: 6,
      sitePolicy: { defaultAction: "allow", rules: [] },
      youtubeMode: "bilingual",
    });
    expect(local.set).toHaveBeenCalledOnce();

    const failing = area(v3);
    vi.mocked(failing.set).mockRejectedValueOnce(new Error("disk full"));
    await expect(createChromeStoreSettings(failing).get()).rejects.toThrow("disk full");
  });

  it("migrates v4 disabled hosts into exact block rules in one persisted v5 record", async () => {
    const local = area({
      disabledHosts: ["a.example", "z.example"],
      globallyEnabled: false,
      networkConsent: null,
      providerId: "openai",
      recipientAccess: {
        eudic: { consent: null, enabled: false },
        shanbay: { consent: null, enabled: false },
      },
      schemaVersion: 4,
      youtubeMode: "bilingual",
    });

    await expect(createChromeStoreSettings(local).get()).resolves.toMatchObject({
      defaultAction: "ask",
      globallyEnabled: false,
      schemaVersion: 6,
      sitePolicy: {
        defaultAction: "allow",
        rules: [
          { action: "block", hostname: "a.example", includeSubdomains: false },
          { action: "block", hostname: "z.example", includeSubdomains: false },
        ],
      },
      youtubeMode: "bilingual",
      youtubeShortcut: null,
    });
    expect(local.set).toHaveBeenCalledOnce();
  });

  it("requires current consent before enablement and revoke disables atomically", async () => {
    const local = area();
    const settings = createChromeStoreSettings(local);

    await expect(settings.setRecipientEnabled("eudic", true)).rejects.toMatchObject({
      code: "consent-required",
    });
    await settings.grantRecipientConsent("eudic", new Date("2026-08-11T03:00:00.000Z"));
    await settings.setRecipientEnabled("eudic", true);
    await expect(settings.get()).resolves.toMatchObject({
      recipientAccess: {
        eudic: {
          consent: { grantedAt: "2026-08-11T03:00:00.000Z", version: 1 },
          enabled: true,
        },
      },
    });
    await settings.revokeRecipientConsent("eudic");
    await expect(settings.get()).resolves.toMatchObject({
      recipientAccess: { eudic: { consent: null, enabled: false } },
    });
  });

  it("fails closed for malformed persisted settings", async () => {
    const settings = createChromeStoreSettings(
      area({
        networkConsent: { grantedAt: "not-a-date", version: 1 },
        providerId: "openai",
        schemaVersion: 1,
      }),
    );

    await expect(settings.get()).rejects.toThrow();
  });
});
