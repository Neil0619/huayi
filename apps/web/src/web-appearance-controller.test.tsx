import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WEB_APPEARANCE_STORAGE_KEY } from "./web-appearance.js";
import { WebAppearanceController } from "./web-appearance-controller.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.appearance;
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  localStorage.clear();
  delete document.documentElement.dataset.appearance;
});

async function renderController(children: ReactNode = <main>页面</main>) {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () =>
    createRoot(container).render(<WebAppearanceController>{children}</WebAppearanceController>),
  );
  return container;
}

describe("WebAppearanceController", () => {
  it("starts from persisted state and owns the selector for its entire surface", async () => {
    localStorage.setItem(WEB_APPEARANCE_STORAGE_KEY, "champagne");
    const container = await renderController(<main>公共、认证或工作台页面</main>);

    expect(document.documentElement.dataset.appearance).toBe("champagne");
    expect(container.textContent).toContain("公共、认证或工作台页面");
    expect(container.querySelector<HTMLInputElement>("input[value='champagne']")?.checked).toBe(
      true,
    );
    expect(container.querySelector(".appearance-menu > summary")?.textContent).toBe(
      "外观 · 香槟晨霜",
    );
  });

  it("synchronizes only exact same-storage events and defaults removed or invalid values", async () => {
    const container = await renderController();

    await act(async () =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "huayi.web.appearance.v10",
          newValue: "moon",
          storageArea: localStorage,
        }),
      ),
    );
    expect(document.documentElement.dataset.appearance).toBe("silver");

    await act(async () =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: WEB_APPEARANCE_STORAGE_KEY,
          newValue: "moon",
          storageArea: sessionStorage,
        }),
      ),
    );
    expect(document.documentElement.dataset.appearance).toBe("silver");

    await act(async () =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: WEB_APPEARANCE_STORAGE_KEY,
          newValue: "porcelain",
          storageArea: localStorage,
        }),
      ),
    );
    expect(document.documentElement.dataset.appearance).toBe("porcelain");
    expect(container.querySelector<HTMLInputElement>("input[value='porcelain']")?.checked).toBe(
      true,
    );

    await act(async () =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: WEB_APPEARANCE_STORAGE_KEY,
          newValue: "unsupported",
          storageArea: localStorage,
        }),
      ),
    );
    expect(document.documentElement.dataset.appearance).toBe("silver");
  });

  it("previews immediately and announces a persistence failure without reverting", async () => {
    const container = await renderController();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const moon = container.querySelector<HTMLInputElement>("input[value='moon']");

    await act(async () => moon?.click());

    expect(document.documentElement.dataset.appearance).toBe("moon");
    expect(moon?.checked).toBe(true);
    const liveRegion = container.querySelector("[aria-live='polite']");
    expect(liveRegion?.textContent).toBe("本次有效，未能保存");
  });
});
