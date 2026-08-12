import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_EXTENSION_SETTINGS } from "../settings/settings-domain.js";
import { SettingsHostClient } from "../settings/settings-host-client.js";
import { SettingsStore } from "../settings/settings-store.js";
import { PopupPage } from "./popup-page.js";

const popupHtml = readFileSync("apps/extension/pages/popup.html", "utf8");

function renderPage(): void {
  document.documentElement.innerHTML = popupHtml;
}

function input(selector: string): HTMLInputElement {
  const control = document.querySelector<HTMLInputElement>(selector);
  if (control === null) throw new Error(`Missing test control: ${selector}`);
  return control;
}

function createPage(): { host: SettingsHostClient; page: PopupPage } {
  const store = new SettingsStore({
    area: { get: vi.fn(async () => ({ settings: DEFAULT_EXTENSION_SETTINGS })), set: vi.fn() },
  });
  const host = new SettingsHostClient();
  vi.spyOn(host, "status").mockRejectedValue(new Error("Host 不可用"));
  return { host, page: new PopupPage(store, host) };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PopupPage", () => {
  it("persists the global toggle and confirms the saved state", async () => {
    renderPage();
    vi.stubGlobal("chrome", {
      runtime: { openOptionsPage: vi.fn() },
      tabs: { query: vi.fn(async () => [{ url: "https://example.com/article" }]) },
    });
    const { host, page } = createPage();
    vi.spyOn(host, "mutateSettings").mockResolvedValue({
      ...DEFAULT_EXTENSION_SETTINGS,
      enabled: false,
    });

    await page.initialize();
    const enabled = input("[data-popup-enabled]");
    enabled.checked = false;
    enabled.dispatchEvent(new Event("change"));

    await vi.waitFor(() => expect(host.mutateSettings).toHaveBeenCalledTimes(1));
    expect(enabled.checked).toBe(false);
    expect(document.querySelector("[data-popup-message]")?.textContent).toBe("设置已保存");
    expect(document.querySelector("[data-popup-message]")?.getAttribute("data-error")).toBe(
      "false",
    );
  });

  it("shows a recoverable error when a save is rejected", async () => {
    renderPage();
    vi.stubGlobal("chrome", {
      runtime: { openOptionsPage: vi.fn() },
      tabs: { query: vi.fn(async () => [{ url: "https://example.com/article" }]) },
    });
    const { host, page } = createPage();
    vi.spyOn(host, "mutateSettings").mockRejectedValue(new Error("后台不可用"));

    await page.initialize();
    const enabled = input("[data-popup-enabled]");
    enabled.checked = false;
    enabled.dispatchEvent(new Event("change"));

    await vi.waitFor(() => {
      expect(document.querySelector("[data-popup-message]")?.textContent).toBe("设置保存失败。");
    });
    expect(document.querySelector("[data-popup-message]")?.getAttribute("data-error")).toBe("true");
  });
});
