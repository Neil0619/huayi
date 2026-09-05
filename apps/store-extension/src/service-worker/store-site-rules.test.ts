import { isSiteEnabled, STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { describe, expect, it } from "vitest";

import { createChromeStoreSettings } from "./store-settings.js";
import { handleSitePolicyMessage } from "./site-policy-handler.js";

function repository() {
  const values: Record<string, unknown> = {};
  return createChromeStoreSettings({
    get: async (key) => ({ [key]: values[key] }),
    set: async (items) => {
      Object.assign(values, structuredClone(items));
    },
    setAccessLevel: async () => undefined,
  });
}
const block = (hostname: string, includeSubdomains = false) => ({
  action: "block" as const,
  hostname,
  includeSubdomains,
});

describe("stored website management", () => {
  it("stores only normalized domains from URLs, IDNA and trailing dots", async () => {
    const settings = repository();
    await settings.upsertSiteRule(block(" HTTPS://Docs.Example.com.:8443/private?q=1 "));
    await settings.upsertSiteRule(block("https://例子.测试/path"));
    expect((await settings.get()).sitePolicy.rules).toEqual([
      block("docs.example.com"),
      block("xn--fsqu00a.xn--0zwm56d"),
    ]);
  });

  it("enforces saved rules on terminal-dot URLs and permits a canonical popup exception", async () => {
    const settings = repository();
    await settings.upsertSiteRule(block("https://Example.com./private", true));
    const request = { messageVersion: STORE_MESSAGE_VERSION, type: "store/site-policy" };
    for (const senderUrl of ["https://example.com./", "https://docs.example.com./private"]) {
      await expect(
        handleSitePolicyMessage(request, senderUrl, settings, async () => "moon"),
      ).resolves.toMatchObject({ enabled: false });
    }
    await expect(
      handleSitePolicyMessage(
        { ...request, type: "store/site-toggle", enabled: true },
        "https://docs.example.com./private",
        settings,
        async () => "moon",
      ),
    ).resolves.toMatchObject({ enabled: true, host: "docs.example.com" });
    expect((await settings.get()).sitePolicy.rules).toContainEqual({
      action: "allow",
      hostname: "docs.example.com",
      includeSubdomains: false,
    });
    expect(isSiteEnabled(await settings.get(), "docs.example.com.")).toBe(true);
    expect(isSiteEnabled(await settings.get(), "other.example.com.")).toBe(false);
    await settings.setSiteEnabled("docs.example.com.", false);
    expect(isSiteEnabled(await settings.get(), "docs.example.com")).toBe(false);
  });

  it("rejects unsafe URLs and suffix-wide rules, keeping IP and localhost exact", async () => {
    const settings = repository();
    for (const value of [
      "https:/example.com",
      "/example.com",
      "example.com..",
      "https://example.com../private",
      "example.com...",
      "com",
      "co.uk",
    ]) {
      await expect(settings.upsertSiteRule(block(value))).rejects.toThrow();
    }
    for (const value of [
      "",
      "*.example.com",
      "https://user:pass@example.com",
      "ftp://example.com",
      "com",
      "co.uk",
      "github.io",
    ]) {
      await expect(settings.upsertSiteRule(block(value, true))).rejects.toThrow();
    }
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      await settings.upsertSiteRule(block(host));
      expect((await settings.get()).sitePolicy.rules).toContainEqual(block(host));
      await expect(settings.upsertSiteRule(block(host, true))).rejects.toThrow();
    }
  });

  it("persists a root block, popup exception, scope edit and exact-key deletion", async () => {
    const values: Record<string, unknown> = {};
    const repository = createChromeStoreSettings({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        Object.assign(values, structuredClone(items));
      },
      setAccessLevel: async () => undefined,
    });
    const root = { action: "block" as const, hostname: "ersoft.cn", includeSubdomains: true };
    await repository.upsertSiteRule(root);
    await repository.setSiteEnabled("wiki.ersoft.cn", true);
    expect(isSiteEnabled(await repository.get(), "wiki.ersoft.cn")).toBe(true);
    expect(isSiteEnabled(await repository.get(), "pm.ersoft.cn")).toBe(false);
    await repository.upsertSiteRule({ ...root, includeSubdomains: false }, root);
    expect(isSiteEnabled(await repository.get(), "pm.ersoft.cn")).toBe(true);
    await repository.removeSiteRule({ hostname: "ersoft.cn", includeSubdomains: false });
    expect((await repository.get()).sitePolicy.rules).toEqual([
      { action: "allow", hostname: "wiki.ersoft.cn", includeSubdomains: false },
    ]);
    expect((await repository.get()).schemaVersion).toBe(6);
    await repository.setSiteEnabled("intranet", false);
    expect(isSiteEnabled(await repository.get(), "intranet")).toBe(false);
  });
});
