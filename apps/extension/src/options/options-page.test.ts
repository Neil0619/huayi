import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_EXTENSION_SETTINGS } from "../settings/settings-domain.js";
import { SettingsHostClient } from "../settings/settings-host-client.js";
import { SettingsStore } from "../settings/settings-store.js";
import { OptionsPage } from "./options-page.js";

const optionsHtml = readFileSync("apps/extension/pages/options.html", "utf8");

function renderPage(): void {
  document.documentElement.innerHTML = optionsHtml;
  history.replaceState(null, "", "/options.html");
}

function input(selector: string): HTMLInputElement {
  const control = document.querySelector<HTMLInputElement>(selector);
  if (control === null) throw new Error(`Missing test control: ${selector}`);
  return control;
}

function createPage(settings = DEFAULT_EXTENSION_SETTINGS): {
  download: ReturnType<typeof vi.fn>;
  host: SettingsHostClient;
  page: OptionsPage;
} {
  const store = new SettingsStore({
    area: { get: vi.fn(async () => ({ settings })), set: vi.fn() },
  });
  const host = new SettingsHostClient();
  const download = vi.fn(async () => undefined);
  vi.spyOn(host, "status").mockRejectedValue(new Error("Host 不可用"));
  return { download, host, page: new OptionsPage(store, host, download) };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("OptionsPage", () => {
  it("persists a successful setting change and renders the saved state", async () => {
    renderPage();
    const { host, page } = createPage();
    const saved = { ...DEFAULT_EXTENSION_SETTINGS, enabled: false };
    vi.spyOn(host, "mutateSettings").mockResolvedValue(saved);

    await page.initialize();
    const enabled = input("[data-setting-enabled]");
    enabled.checked = false;
    enabled.dispatchEvent(new Event("change"));

    await vi.waitFor(() => expect(host.mutateSettings).toHaveBeenCalledTimes(1));
    expect(enabled.checked).toBe(false);
    expect(document.querySelector("[data-settings-status]")?.textContent).toBe("设置已保存");
    expect(document.querySelector("[data-settings-status]")?.getAttribute("data-tone")).toBe(
      "success",
    );
  });

  it("handles a rejected save, reports it, and rolls the changed control back", async () => {
    renderPage();
    const { host, page } = createPage();
    vi.spyOn(host, "mutateSettings").mockRejectedValue(new Error("规则数量已达上限"));

    await page.initialize();
    const enabled = input("[data-setting-enabled]");
    enabled.checked = false;
    enabled.dispatchEvent(new Event("change"));

    await vi.waitFor(() => {
      expect(document.querySelector("[data-settings-status]")?.textContent).toBe(
        "规则数量已达上限",
      );
    });
    expect(document.querySelector("[data-settings-status]")?.getAttribute("data-tone")).toBe(
      "error",
    );
    expect(enabled.checked).toBe(true);
  });

  it("downloads a no-secret Store migration package through the visible async boundary", async () => {
    renderPage();
    const { download, page } = createPage({
      ...DEFAULT_EXTENSION_SETTINGS,
      defaultAction: "explain",
      wordbook: { automaticSync: true, enabled: true, syncHour: 22 },
    });
    await page.initialize();

    document.querySelector<HTMLButtonElement>("[data-export-store-settings]")?.click();

    await vi.waitFor(() => {
      expect(download).toHaveBeenCalledOnce();
      expect(document.querySelector("[data-settings-status]")?.textContent).toContain("已导出");
    });
    const [filename, contents, mimeType] = download.mock.calls[0] as [string, string, string];
    expect(filename).toBe("huayi-classic-settings-v1.json");
    expect(mimeType).toBe("application/json");
    expect(JSON.parse(contents)).toMatchObject({
      format: "huayi-classic-settings",
      settings: { defaultAction: "explain" },
    });
    expect(contents).not.toMatch(/automaticSync|syncHour|api.?key|authorization|provider/iu);
  });

  it("reports a rejected migration download without an unhandled rejection", async () => {
    renderPage();
    const { download, page } = createPage();
    download.mockRejectedValueOnce(new Error("下载被浏览器拒绝"));
    await page.initialize();

    document.querySelector<HTMLButtonElement>("[data-export-store-settings]")?.click();

    await vi.waitFor(() =>
      expect(document.querySelector("[data-settings-status]")?.textContent).toBe(
        "下载被浏览器拒绝",
      ),
    );
    expect(document.querySelector("[data-settings-status]")?.getAttribute("data-tone")).toBe(
      "error",
    );
  });
});
