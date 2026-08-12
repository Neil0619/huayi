import { afterEach, describe, expect, it, vi } from "vitest";

import { createHarness, element, renderPage } from "./options-page.test-support.js";

afterEach(() => {
  document.documentElement.replaceChildren(
    document.createElement("head"),
    document.createElement("body"),
  );
  vi.restoreAllMocks();
});

describe("Store OptionsPage", () => {
  it("gives every settings tab one uniquely labelled controlled panel", () => {
    renderPage();

    const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='tab']"));
    expect(tabs).toHaveLength(4);
    expect(document.querySelectorAll("[role='tabpanel']")).toHaveLength(4);
    expect(document.querySelector("[data-settings-nav='migration']")).toBeNull();
    expect(document.querySelector("[data-import-classic-settings]")).toBeNull();
    for (const tab of tabs) {
      const controlledId = tab.getAttribute("aria-controls");
      expect(tab.id).not.toBe("");
      expect(controlledId).not.toBeNull();
      const panel = document.getElementById(controlledId ?? "");
      expect(panel?.getAttribute("role")).toBe("tabpanel");
      expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
    }
  });

  it("uses a compact project header with the public GitHub repository", () => {
    renderPage();
    const link = element<HTMLAnchorElement>("[data-github-project]");
    expect(link.href).toBe("https://github.com/Neil0619/huayi");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(document.querySelector(".hero")).toBeNull();
    expect(document.querySelector(".settings-toolbar")).not.toBeNull();
    expect(document.querySelector(".settings-toolbar h1")?.textContent).toBe("划译设置");
    expect(document.querySelector(".eyebrow")).toBeNull();
    expect(element("[data-page-status]").textContent).toBe("");
  });

  it("uses direct functional copy and switches only for persistent binary settings", () => {
    renderPage();

    expect(document.body.textContent).toContain("启用范围");
    expect(document.body.textContent).toContain("在所有网站启用");
    expect(document.body.textContent).toContain("单独关闭的网站");
    expect(document.body.textContent).toContain("模型联网许可");
    expect(document.body.textContent).toContain("模型与划词动作");
    expect(document.body.textContent).toContain("YouTube 字幕");
    expect(document.body.textContent).not.toContain("hostname");
    expect(element<HTMLInputElement>("[data-global-enabled]").getAttribute("role")).toBe("switch");
    for (const recipient of ["eudic", "shanbay"]) {
      expect(
        element<HTMLInputElement>(`[data-recipient-enabled='${recipient}']`).getAttribute("role"),
      ).toBe("switch");
    }
    expect(document.querySelector("[data-restore-confirm]")).toBeNull();
    expect(document.querySelector("[data-plaintext-risk]")).toBeNull();
  });

  it("shows only common settings by default and switches categories without resetting fields", async () => {
    renderPage();
    const { page } = createHarness();
    await page.initialize();

    const common = element<HTMLElement>("[data-settings-section='common']");
    const credentials = element<HTMLElement>("[data-settings-section='credentials']");
    const provider = element<HTMLSelectElement>("[data-provider]");
    provider.value = "deepseek";

    expect(common.hidden).toBe(false);
    expect(credentials.hidden).toBe(true);
    element<HTMLButtonElement>("[data-settings-nav='credentials']").click();
    expect(credentials.hidden).toBe(false);
    expect(common.hidden).toBe(true);
    expect(provider.value).toBe("deepseek");
    expect(element("[data-settings-nav='credentials']").getAttribute("aria-selected")).toBe("true");
  });

  it("uses keyboard navigation across the four current categories", async () => {
    renderPage();
    const { page } = createHarness();
    await page.initialize();

    const common = element<HTMLButtonElement>("[data-settings-nav='common']");
    common.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(element("[data-settings-nav='lexicon']").getAttribute("aria-selected")).toBe("true");
  });

  it("starts ready without password, recovery, lock, or unlock controls", async () => {
    renderPage();
    const { page, vault } = createHarness();
    await page.initialize();

    expect(element("[data-network-disclosure]").textContent).toContain("选中的英文和上下文");
    expect(element("[data-page-status]").getAttribute("aria-live")).toBe("polite");
    expect(vault.ensureReady).toHaveBeenCalledOnce();
    expect(element<HTMLElement>("[data-device-vault-ready]").hidden).toBe(false);
    expect(document.querySelector("[data-unlock-form]")).toBeNull();
    expect(document.querySelector("[data-lock]")).toBeNull();
    expect(document.querySelector("[data-change-passphrase-form]")).toBeNull();
    expect(document.querySelector("[data-confirm-recovery-form]")).toBeNull();
  });

  it("grants and revokes disclosure consent and persists provider selection", async () => {
    renderPage();
    const { page, settings } = createHarness();
    await page.initialize();

    element<HTMLButtonElement>("[data-grant-consent]").click();
    await vi.waitFor(() => expect(element("[data-consent-state]").textContent).toContain("已同意"));
    expect(settings.grantNetworkConsent).toHaveBeenCalledTimes(1);

    const provider = element<HTMLSelectElement>("[data-provider]");
    provider.value = "deepseek";
    provider.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(provider.disabled).toBe(false));
    expect(settings.setProvider).toHaveBeenCalledWith("deepseek");

    element<HTMLButtonElement>("[data-revoke-consent]").click();
    await vi.waitFor(() =>
      expect(element("[data-consent-state]").textContent).toBe("尚未同意联网"),
    );
    expect(settings.revokeNetworkConsent).toHaveBeenCalledTimes(1);
  });

  it("persists the explicit recorded-video YouTube subtitle preference", async () => {
    renderPage();
    const { page, settings } = createHarness();
    await page.initialize();

    const mode = element<HTMLSelectElement>("[data-youtube-mode]");
    expect(mode.value).toBe("english");
    mode.value = "bilingual";
    mode.dispatchEvent(new Event("change"));

    await vi.waitFor(() => {
      expect(settings.setYoutubeMode).toHaveBeenCalledWith("bilingual");
      expect(mode.value).toBe("bilingual");
    });
  });

  it("updates the global policy and removes only listed disabled hosts", async () => {
    renderPage();
    const { notifySitePolicyChanged, page, settings } = createHarness();
    await page.initialize();

    const global = element<HTMLInputElement>("[data-global-enabled]");
    expect(global.checked).toBe(true);
    expect(element("[data-disabled-hosts]").textContent).toContain("blocked.example");
    global.checked = false;
    global.dispatchEvent(new Event("change"));
    await vi.waitFor(() => {
      expect(settings.setGloballyEnabled).toHaveBeenCalledWith(false);
      expect(notifySitePolicyChanged).toHaveBeenCalledOnce();
    });

    element<HTMLButtonElement>("[data-enable-host='blocked.example']").click();
    await vi.waitFor(() => {
      expect(settings.setSiteEnabled).toHaveBeenCalledWith("blocked.example", true);
      expect(element("[data-disabled-hosts]").textContent).not.toContain("blocked.example");
      expect(notifySitePolicyChanged).toHaveBeenCalledTimes(2);
    });
    expect(element("[data-disabled-hosts]").textContent).toContain("news.example");
  });

  it("shows per-recipient disclosure and keeps consent separate from enablement", async () => {
    renderPage();
    const { page, settings } = createHarness();
    await page.initialize();

    expect(element("[data-recipient-card='eudic']").textContent).toContain("词头、原句和语境释义");
    expect(element("[data-recipient-card='eudic']").textContent).toContain("远端保留");
    expect(element("[data-recipient-card='shanbay']").textContent).toContain("服务费用");

    element<HTMLButtonElement>("[data-recipient-grant='eudic']").click();
    await vi.waitFor(() =>
      expect(element("[data-recipient-state='eudic']").textContent).toContain("已同意，未启用"),
    );
    expect(settings.grantRecipientConsent).toHaveBeenCalledWith("eudic", expect.any(Date));
    expect(settings.setRecipientEnabled).not.toHaveBeenCalled();

    const enabled = element<HTMLInputElement>("[data-recipient-enabled='eudic']");
    enabled.checked = true;
    enabled.dispatchEvent(new Event("change"));
    await vi.waitFor(() =>
      expect(element("[data-recipient-state='eudic']").textContent).toContain("已同意并启用"),
    );
    expect(settings.setRecipientEnabled).toHaveBeenCalledWith("eudic", true);

    element<HTMLButtonElement>("[data-recipient-revoke='eudic']").click();
    await vi.waitFor(() =>
      expect(element("[data-recipient-state='eudic']").textContent).toContain("尚未同意"),
    );
    expect(settings.revokeRecipientConsent).toHaveBeenCalledWith("eudic");
  });

  it("fails closed without rendering migration controls when old encrypted data exists", async () => {
    renderPage();
    const { page } = createHarness("migration-required");
    await page.initialize();

    expect(element<HTMLElement>("[data-device-vault-ready]").hidden).toBe(true);
    expect(document.querySelector("[data-legacy-migration-form]")).toBeNull();
    expect(element("[data-page-status]").textContent).toContain("不再提供迁移");
  });

  it("stores and deletes credentials without rendering existing secret values", async () => {
    renderPage();
    const { page, vault } = createHarness();
    vi.mocked(vault.getCredential).mockImplementation(async (slot) =>
      slot === "openai-api-key" ? "sk-existing-secret" : null,
    );
    await page.initialize();

    expect(document.body.textContent).not.toContain("sk-existing-secret");
    expect(element("[data-credential-status='openai-api-key']").textContent).toBe("已配置");
    expect(element<HTMLInputElement>("[data-credential-input='openai-api-key']").value).toBe("");

    const input = element<HTMLInputElement>("[data-credential-input='deepseek-api-key']");
    input.value = "sk-new-secret";
    element<HTMLButtonElement>("[data-credential-save='deepseek-api-key']").click();
    await vi.waitFor(() => expect(document.body.getAttribute("aria-busy")).toBe("false"));
    expect(vault.setCredential).toHaveBeenCalledOnce();
    expect(element("[data-page-status]").textContent).toBe("");
    expect(vault.setCredential).toHaveBeenCalledWith("deepseek-api-key", "sk-new-secret");
    expect(input.value).toBe("");
    expect(document.body.textContent).not.toContain("sk-new-secret");

    element<HTMLButtonElement>("[data-credential-delete='openai-api-key']").click();
    await vi.waitFor(() => expect(document.body.getAttribute("aria-busy")).toBe("false"));
    expect(vault.deleteCredential).toHaveBeenCalledOnce();
    expect(element("[data-page-status]").textContent).toBe("");
    expect(vault.deleteCredential).toHaveBeenCalledWith("openai-api-key");
  });

  it("uses one busy/error boundary, rolls back settings, and reports stable Chinese errors", async () => {
    renderPage();
    const { page, settings } = createHarness();
    vi.mocked(settings.setProvider).mockRejectedValue(new Error("raw storage failure"));
    await page.initialize();

    const provider = element<HTMLSelectElement>("[data-provider]");
    provider.value = "deepseek";
    provider.dispatchEvent(new Event("change"));

    expect(document.body.getAttribute("aria-busy")).toBe("true");
    await vi.waitFor(() =>
      expect(element("[data-page-status]").textContent).toBe("操作失败，请稍后重试。"),
    );
    expect(document.body.getAttribute("aria-busy")).toBe("false");
    expect(provider.value).toBe("openai");

    vi.mocked(settings.setGloballyEnabled).mockRejectedValue(new Error("raw storage failure"));
    const globallyEnabled = element<HTMLInputElement>("[data-global-enabled]");
    globallyEnabled.checked = false;
    globallyEnabled.dispatchEvent(new Event("change"));
    await vi.waitFor(() => {
      expect(globallyEnabled.checked).toBe(true);
      expect(element("[data-page-status]").textContent).toBe("操作失败，请稍后重试。");
    });
  });
});
