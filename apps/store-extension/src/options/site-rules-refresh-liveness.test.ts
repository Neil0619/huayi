import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { broadcastSettingsRefresh } from "../service-worker/settings-refresh-broadcaster.js";
import { handleSitePoliciesChanged } from "../service-worker/site-policy-broadcaster.js";
import { createHarness, element, renderPage, submit } from "./options-page.test-support.js";

const rule = { action: "block", hostname: "ersoft.cn1", includeSubdomains: false } as const;

describe("website rule save completion", () => {
  beforeEach(renderPage);
  afterEach(() => vi.unstubAllGlobals());

  it.each(["add", "delete"])(
    "finishes %s and unlocks settings while another tab never replies to refresh",
    async (operation) => {
      const sendMessage = vi.fn((tabId: number) =>
        tabId === 1 ? new Promise<never>(() => undefined) : Promise.resolve(undefined),
      );
      vi.stubGlobal("chrome", {
        tabs: { query: async () => [{ id: 1 }, { id: 2 }], sendMessage },
      });
      const { page, settings, notifySitePolicyChanged } = createHarness();
      notifySitePolicyChanged.mockImplementation(async () => {
        await handleSitePoliciesChanged(
          { messageVersion: STORE_MESSAGE_VERSION, type: "store/site-policies-changed" },
          { id: "extension-id", url: "chrome-extension://extension-id/options.html" },
          "extension-id",
          broadcastSettingsRefresh,
        );
      });
      if (operation === "delete") await settings.upsertSiteRule(rule);
      await page.initialize();
      element<HTMLButtonElement>("[data-settings-nav='sites']").click();
      if (operation === "add") {
        element<HTMLInputElement>("[data-site-rule-host]").value = rule.hostname;
        submit("[data-site-rule-form]");
      } else {
        const row = [...document.querySelectorAll<HTMLElement>("[data-site-rule-row]")].find(
          (candidate) => candidate.querySelector("strong")?.textContent === rule.hostname,
        );
        expect(row).toBeDefined();
        row?.querySelector<HTMLButtonElement>("[data-site-rule-delete]")?.click();
      }

      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
      expect(
        (await settings.get()).sitePolicy.rules.some((item) => item.hostname === rule.hostname),
      ).toBe(operation === "add");
      await vi.waitFor(
        () => {
          expect(document.body.getAttribute("aria-busy")).toBe("false");
          expect(element<HTMLButtonElement>("[data-site-rule-save]").disabled).toBe(false);
          expect(element("[data-page-status]").textContent).toBe("");
          expect(element("[data-site-rules]").textContent?.includes(rule.hostname)).toBe(
            operation === "add",
          );
        },
        { timeout: 250 },
      );
    },
  );
});
