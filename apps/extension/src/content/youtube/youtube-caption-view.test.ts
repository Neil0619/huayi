import { afterEach, describe, expect, it, vi } from "vitest";

import { createCaptionPickerView } from "./youtube-caption-view.js";

afterEach(() => {
  document.body.textContent = "";
});

describe("createCaptionPickerView", () => {
  it("shows live text without selection controls until the caption is ready", () => {
    const onSelection = vi.fn();
    const view = createCaptionPickerView({
      captionText: "The sentence is",
      completeness: "best-effort",
      continueLabel: "取消",
      document,
      mode: "completing",
      onClose: vi.fn(),
      onSelection,
    });
    document.body.append(view.host);

    const dialog = view.host.shadowRoot?.querySelector("[role='dialog']");
    const selectCaption = view.host.shadowRoot?.querySelector<HTMLButtonElement>(
      "[data-action='select-caption']",
    );
    expect(dialog?.getAttribute("aria-busy")).toBe("true");
    expect(view.host.shadowRoot?.textContent).toContain("正在补全当前句");
    expect(selectCaption?.disabled).toBe(true);
    expect(view.host.shadowRoot?.querySelectorAll("[data-caption-word]")).toHaveLength(0);

    view.updateText("The sentence is complete enough");
    expect(view.host.shadowRoot?.textContent).toContain("The sentence is complete enough");

    view.setMode("ready", {
      completeness: "best-effort",
      continueLabel: "继续播放",
    });
    expect(dialog?.getAttribute("aria-busy")).toBe("false");
    expect(view.host.shadowRoot?.textContent).toContain("未检测到完整句尾，已使用当前片段");
    expect(selectCaption?.disabled).toBe(false);
    expect(selectCaption?.textContent).toBe("当前字幕");

    const sentence = [
      ...(view.host.shadowRoot?.querySelectorAll<HTMLButtonElement>("[data-caption-word]") ?? []),
    ].find((word) => word.textContent === "sentence");
    sentence?.click();
    expect(onSelection).toHaveBeenCalledOnce();
    expect(onSelection.mock.calls[0]?.[0].input).toMatchObject({
      context: "The sentence is complete enough",
      selection: "sentence",
      sentenceContext: "The sentence is complete enough",
    });

    view.updateText("A late mutation must be ignored");
    expect(view.host.shadowRoot?.textContent).not.toContain("A late mutation");
    view.destroy();
  });

  it("labels a completed target as a whole sentence", () => {
    const view = createCaptionPickerView({
      captionText: "A complete sentence.",
      completeness: "complete",
      continueLabel: "关闭取词",
      document,
      mode: "ready",
      onClose: vi.fn(),
      onSelection: vi.fn(),
    });

    expect(view.host.shadowRoot?.querySelector("[data-action='select-caption']")?.textContent).toBe(
      "整句字幕",
    );
    view.destroy();
  });
});
