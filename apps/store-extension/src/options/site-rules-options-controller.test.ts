import { beforeEach, describe, expect, it } from "vitest";

import { createHarness, element, renderPage, submit } from "./options-page.test-support.js";

describe("website management", () => {
  beforeEach(renderPage);

  it("has an independent page and normalizes manual root blocks with scope previews", async () => {
    const { page, settings } = createHarness();
    await page.initialize();
    element<HTMLButtonElement>("[data-settings-nav='sites']").click();
    expect(element("#settings-sites").hidden).toBe(false);
    const input = element<HTMLInputElement>("[data-site-rule-host]");
    input.value = "https://Ersoft.cn/private";
    element<HTMLSelectElement>("[data-site-rule-scope]").value = "subdomains";
    input.dispatchEvent(new Event("input"));
    expect(element("[data-site-rule-preview]").textContent).toContain("ersoft.cn 及所有子域名");
    submit("[data-site-rule-form]");
    await expect
      .poll(async () => (await settings.get()).sitePolicy.rules)
      .toContainEqual({
        action: "block",
        hostname: "ersoft.cn",
        includeSubdomains: true,
      });
    expect(document.querySelector("[data-cloud-account-entry]")).toBeNull();
  });

  it("paginates, filters, edits scope, and clamps after deleting the final page", async () => {
    const { page, settings } = createHarness();
    for (let index = 0; index < 19; index++)
      await settings.upsertSiteRule({
        action: "block",
        hostname: `z${String(index).padStart(2, "0")}.example.com`,
        includeSubdomains: false,
      });
    await page.initialize();
    element<HTMLButtonElement>("[data-settings-nav='sites']").click();
    expect(document.querySelectorAll("[data-site-rule-row]")).toHaveLength(20);
    element<HTMLButtonElement>("[data-site-rule-next]").click();
    expect(document.querySelectorAll("[data-site-rule-row]")).toHaveLength(1);
    element<HTMLButtonElement>("[data-site-rule-delete]").click();
    await expect.poll(() => document.querySelectorAll("[data-site-rule-row]").length).toBe(20);
    expect(element("[data-site-rule-pagination]").hidden).toBe(true);
    const search = element<HTMLInputElement>("[data-site-rule-search]");
    search.value = "blocked";
    search.dispatchEvent(new Event("input"));
    expect(document.querySelectorAll("[data-site-rule-row]")).toHaveLength(1);
    element<HTMLButtonElement>("[data-site-rule-edit]").click();
    element<HTMLSelectElement>("[data-site-rule-scope]").value = "subdomains";
    submit("[data-site-rule-form]");
    await expect
      .poll(
        async () =>
          (await settings.get()).sitePolicy.rules.find(
            (rule) => rule.hostname === "blocked.example",
          )?.includeSubdomains,
      )
      .toBe(true);
  });

  it("clears an edit when that rule is deleted", async () => {
    const { page } = createHarness();
    await page.initialize();
    element<HTMLButtonElement>("[data-settings-nav='sites']").click();
    element<HTMLButtonElement>("[data-site-rule-edit]").click();
    expect(element("[data-site-rule-save]").textContent).toBe("保存修改");
    element<HTMLButtonElement>("[data-site-rule-delete]").click();
    await expect.poll(() => element("[data-site-rule-save]").textContent).toBe("添加规则");
    expect(element<HTMLInputElement>("[data-site-rule-host]").value).toBe("");
  });
});
