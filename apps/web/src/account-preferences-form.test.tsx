import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountPreferencesForm } from "./account-preferences-form.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const current = {
  cloudWordCopyMode: "enabled" as const,
  dailyGoal: 3,
  extensionQueryModelMode: "platform" as const,
  revision: 1,
  studyCaptureMode: "manual" as const,
  timezone: "UTC",
  updatedAt: "2026-08-13T10:00:00.000Z",
};

async function change(control: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("account preferences form", () => {
  beforeEach(() => document.body.replaceChildren());

  it("loads, validates, saves, and announces the server-confirmed preferences", async () => {
    const api = {
      updateAccountPreferences: vi.fn(async () => ({
        ...current,
        dailyGoal: 5,
        extensionQueryModelMode: "byok" as const,
        revision: 2,
        timezone: "Asia/Shanghai",
      })),
    };
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () =>
      createRoot(container).render(
        <AccountPreferencesForm api={api} initialPreferences={current} />,
      ),
    );

    const timezone = container.querySelector<HTMLInputElement>("[name='timezone']");
    const dailyGoal = container.querySelector<HTMLInputElement>("[name='dailyGoal']");
    expect(timezone?.value).toBe("UTC");
    expect(dailyGoal?.value).toBe("3");
    if (timezone === null || dailyGoal === null) throw new Error("Expected preference controls.");
    await change(timezone, "Asia/Shanghai");
    await change(dailyGoal, "5");
    const modelMode = container.querySelector<HTMLSelectElement>(
      "[name='extensionQueryModelMode']",
    );
    if (modelMode === null) throw new Error("Expected model mode control.");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(modelMode, "byok");
      modelMode.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () =>
      container.querySelector<HTMLButtonElement>("button[type='submit']")?.click(),
    );
    expect(api.updateAccountPreferences).toHaveBeenCalledWith({
      cloudWordCopyMode: "enabled",
      dailyGoal: 5,
      expectedRevision: 1,
      extensionQueryModelMode: "byok",
      studyCaptureMode: "manual",
      timezone: "Asia/Shanghai",
    });
    expect(container.querySelector("[role='status']")?.textContent).toContain("已保存");
    expect(container.textContent).toContain("所有已关联插件");
  });

  it("retains the draft after a save error", async () => {
    const api = {
      updateAccountPreferences: vi.fn(async () => {
        throw new Error("offline");
      }),
    };
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () =>
      createRoot(container).render(
        <AccountPreferencesForm api={api} initialPreferences={current} />,
      ),
    );
    const timezone = container.querySelector<HTMLInputElement>("[name='timezone']");
    if (timezone === null) throw new Error("Expected timezone control.");
    await change(timezone, "Asia/Tokyo");
    await act(async () =>
      container.querySelector<HTMLButtonElement>("button[type='submit']")?.click(),
    );
    expect(container.querySelector("[role='alert']")?.textContent).toContain("保存失败");
    expect(timezone?.value).toBe("Asia/Tokyo");
  });
});
