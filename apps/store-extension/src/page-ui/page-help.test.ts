import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { bindPageHelp } from "./page-help.js";

afterEach(() => document.body.replaceChildren());

describe("page help", () => {
  it("keeps form labels on their input instead of the help button", () => {
    document.documentElement.innerHTML = readFileSync(
      "apps/store-extension/pages/options.html",
      "utf8",
    );
    const dispose = bindPageHelp(document);
    for (const selector of ["[data-provider]", "[data-default-action]", "[data-youtube-mode]"]) {
      const control = document.querySelector<HTMLSelectElement>(selector);
      expect(control?.labels?.length).toBe(1);
      expect(control?.labels?.[0]?.querySelector("button")).toBeNull();
    }
    dispose();
  });
  it("opens on focus/hover, pins on click, dismisses with Escape and restores focus", () => {
    document.body.innerHTML =
      '<h3>模型</h3><p data-help-note="模型说明">只在主动查询时发送所选内容。</p>';
    const dispose = bindPageHelp(document);
    const button = document.querySelector<HTMLButtonElement>("[data-help-toggle]");
    const content = document.querySelector<HTMLElement>("[role='tooltip']");
    expect(button?.getAttribute("aria-label")).toBe("模型说明");
    expect(content?.hidden).toBe(true);
    button?.focus();
    expect(content?.hidden).toBe(false);
    button?.click();
    button?.blur();
    expect(content?.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(content?.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
    button?.dispatchEvent(new MouseEvent("pointerenter"));
    expect(content?.hidden).toBe(false);
    dispose();
    expect(content?.hidden).toBe(true);
  });
});
