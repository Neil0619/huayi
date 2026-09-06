import { afterEach, describe, expect, it, vi } from "vitest";

import { createHarness, element, renderPage } from "./options-page.test-support.js";

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  document.documentElement.replaceChildren(
    document.createElement("head"),
    document.createElement("body"),
  );
  vi.restoreAllMocks();
});

async function chooseProvider(value: string): Promise<void> {
  const provider = element<HTMLSelectElement>("[data-provider]");
  provider.value = value;
  provider.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(provider.disabled).toBe(false));
}

describe("model settings and credentials", () => {
  it("keeps provider drafts separate and saves only the visible provider's key", async () => {
    renderPage();
    const { page, vault } = createHarness();
    await page.initialize();
    element<HTMLButtonElement>("[data-settings-nav='credentials']").click();
    const openai = element<HTMLInputElement>("[data-credential-input='openai-api-key']");
    const deepseek = element<HTMLInputElement>("[data-credential-input='deepseek-api-key']");
    openai.value = "openai-unsaved-draft";

    await chooseProvider("deepseek");
    expect(deepseek.closest("[hidden]")).toBeNull();
    expect(openai.closest("[hidden]")).not.toBeNull();
    deepseek.value = "deepseek-unsaved-draft";
    await chooseProvider("openai");
    expect(openai.closest("[hidden]")).toBeNull();
    expect(deepseek.closest("[hidden]")).not.toBeNull();
    expect(openai.value).toBe("openai-unsaved-draft");
    expect(vault.setCredential).not.toHaveBeenCalled();

    await chooseProvider("deepseek");
    expect(deepseek.value).toBe("deepseek-unsaved-draft");
    element<HTMLButtonElement>("[data-credential-save='deepseek-api-key']").click();
    await vi.waitFor(() => expect(deepseek.value).toBe(""));
    expect(deepseek.placeholder).toBe("••••••••");
    expect(await vault.getCredential("deepseek-api-key")).toBe("deepseek-unsaved-draft");
    expect(await vault.getCredential("openai-api-key")).toBeNull();
    expect(openai.value).toBe("openai-unsaved-draft");
  });

  it("shows the original provider's credential if changing provider fails", async () => {
    renderPage();
    const { page, settings } = createHarness();
    await settings.setProvider("deepseek");
    await page.initialize();
    element<HTMLButtonElement>("[data-settings-nav='credentials']").click();
    vi.mocked(settings.setProvider).mockRejectedValue(new Error("storage unavailable"));

    await chooseProvider("openai");
    expect(element<HTMLSelectElement>("[data-provider]").value).toBe("deepseek");
    expect(element("[data-credential-input='deepseek-api-key']").closest("[hidden]")).toBeNull();
    expect(element("[data-credential-input='openai-api-key']").closest("[hidden]")).not.toBeNull();
    expect(element("[data-page-status]").textContent).toBe("操作失败，请稍后重试。");
  });
});
