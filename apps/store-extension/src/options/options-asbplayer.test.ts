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

describe("asbplayer watching preferences", () => {
  it("saves independent mode and refreshes active playback frames", async () => {
    renderPage();
    const { page, settings, notifySitePolicyChanged } = createHarness();
    await page.initialize();
    const mode = element<HTMLSelectElement>("[data-asbplayer-mode]");
    expect(mode.value).toBe("english");
    mode.value = "bilingual";
    mode.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(notifySitePolicyChanged).toHaveBeenCalledOnce());
    expect(settings.setAsbplayerMode).toHaveBeenCalledWith("bilingual");
    expect(settings.setYoutubeMode).not.toHaveBeenCalled();
  });
  it("records and clears an independent shortcut, broadcasting each change", async () => {
    renderPage();
    const { page, settings, notifySitePolicyChanged } = createHarness();
    await page.initialize();
    const button = element<HTMLButtonElement>("[data-asbplayer-shortcut]");
    button.click();
    button.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyT", altKey: true, bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(notifySitePolicyChanged).toHaveBeenCalledOnce());
    expect(settings.setAsbplayerShortcut).toHaveBeenCalledWith({
      alt: true,
      code: "KeyT",
      ctrl: false,
      meta: false,
      shift: false,
    });
    expect(button.textContent).toBe("Alt + T");
    element<HTMLButtonElement>("[data-asbplayer-shortcut-clear]").click();
    await vi.waitFor(() => expect(notifySitePolicyChanged).toHaveBeenCalledTimes(2));
    expect(button.textContent).toBe("已关闭");
    expect(settings.setYoutubeShortcut).not.toHaveBeenCalled();
  });
});
