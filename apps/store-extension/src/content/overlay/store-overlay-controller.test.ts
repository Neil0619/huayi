import { beforeEach, describe, expect, it, vi } from "vitest";

import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";

import {
  click,
  reading,
  selectText,
  setup,
  shadow,
} from "./store-overlay-controller.test-support.js";

describe("Store selection overlay", () => {
  beforeEach(() => {
    document.body.textContent = "";
  });

  it.each([
    ["investigation", "word"],
    ["early stages", "phrase"],
    ["The investigation began.", "sentence"],
  ] as const)("offers translation and explanation for a %s", (selection, kind) => {
    const { controller } = setup();
    controller.show(reading(selection, kind), { bottom: 80, left: 40, top: 60 });

    expect(shadow().querySelector("[role='dialog']")?.getAttribute("aria-label")).toBe("划译分析");
    expect(shadow().querySelector("[data-brand-mark]")).toBeNull();
    expect(shadow().querySelector("[data-selection]")).toBeNull();
    expect(shadow().textContent).not.toContain(selection);
    expect(shadow().querySelectorAll("[data-action]")).toHaveLength(2);
    expect(shadow().querySelector("[data-close]")).toBeNull();
  });

  it("keeps the two modes in the single header row and caches each completed result", () => {
    const { controller, ports } = setup();
    controller.show(reading("investigation", "word"), { bottom: 80, left: 40, top: 60 });

    const header = shadow().querySelector(".header");
    expect(header?.querySelectorAll("[data-action]")).toHaveLength(2);
    expect(shadow().querySelector(":scope > .actions")).toBeNull();

    click("[data-action='translate']");
    expect(shadow().querySelector("[data-brand-mark]")).not.toBeNull();
    ports[0]?.receive({
      messageVersion: STORE_MESSAGE_VERSION,
      result: {
        commonMeanings: [{ meaningsZh: ["调查"], partOfSpeech: "noun" }],
        commonPhrases: [],
        confusableWords: [],
        contextualSense: { meaningZh: "调查", partOfSpeech: "noun" },
        dictionaryForm: "investigation",
        requestId: "translate-1",
        selectionKind: "word",
        sourceText: "investigation",
        type: "translate-word",
      },
      type: "store/analysis-result",
    });
    expect(shadow().querySelector("[data-result-type='translate-word']")).not.toBeNull();

    click("[data-action='explain']");
    expect(ports).toHaveLength(2);
    ports[1]?.receive({
      messageVersion: STORE_MESSAGE_VERSION,
      result: {
        contextualAnalysisZh: "这里指调查这件事。",
        requestId: "explain-1",
        selectionKind: "word",
        sourceText: "investigation",
        synonyms: [],
        type: "explain-word",
        usageNotes: [],
        wordForm: { baseForm: "investigation", formTypeZh: "名词" },
      },
      type: "store/analysis-result",
    });
    expect(shadow().querySelector("[data-result-type='explain-word']")).not.toBeNull();

    click("[data-action='translate']");
    expect(ports).toHaveLength(2);
    expect(shadow().querySelector("[data-result-type='translate-word']")).not.toBeNull();
    click("[data-action='explain']");
    expect(ports).toHaveLength(2);
    expect(shadow().querySelector("[data-result-type='explain-word']")).not.toBeNull();
  });

  it("cancels only the loading mode and keeps completed and failed modes isolated", () => {
    const { controller, ports } = setup();
    controller.show(reading("investigation", "word"), { bottom: 80, left: 40, top: 60 });
    click("[data-action='translate']");
    ports[0]?.receive({
      messageVersion: STORE_MESSAGE_VERSION,
      result: {
        commonMeanings: [{ meaningsZh: ["调查"], partOfSpeech: "noun" }],
        commonPhrases: [],
        confusableWords: [],
        contextualSense: { meaningZh: "调查", partOfSpeech: "noun" },
        dictionaryForm: "investigation",
        requestId: "translate-cached",
        selectionKind: "word",
        sourceText: "investigation",
        type: "translate-word",
      },
      type: "store/analysis-result",
    });

    click("[data-action='explain']");
    ports[1]?.receive({
      code: "invalid-response",
      messageVersion: STORE_MESSAGE_VERSION,
      requestId: null,
      type: "store/analysis-error",
    });
    expect(shadow().querySelector("[role='alert']")?.textContent).toContain("无效响应");
    click("[data-action='translate']");
    expect(shadow().querySelector("[data-result-type='translate-word']")).not.toBeNull();
    click("[data-action='explain']");
    expect(ports).toHaveLength(2);
    expect(shadow().querySelector("[role='alert']")?.textContent).toContain("无效响应");

    click("[data-retry]");
    expect(ports).toHaveLength(3);
    click("[data-action='translate']");
    expect(ports[2]?.postMessage).toHaveBeenLastCalledWith({
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/analysis-cancel",
    });
    expect(shadow().querySelector("[data-result-type='translate-word']")).not.toBeNull();
  });

  it("discards the CardSession on replacement and ignores stale port messages", () => {
    const { controller, ports } = setup();
    controller.show(reading("investigation", "word"), { bottom: 80, left: 40, top: 60 });
    click("[data-action='translate']");
    click("[data-action='explain']");
    expect(ports[0]?.postMessage).toHaveBeenLastCalledWith({
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/analysis-cancel",
    });
    ports[0]?.receive({
      code: "network-error",
      messageVersion: STORE_MESSAGE_VERSION,
      requestId: null,
      type: "store/analysis-error",
    });
    expect(shadow().querySelector("[role='alert']")).toBeNull();

    controller.show(reading("evidence", "word"), { bottom: 90, left: 50, top: 70 });
    click("[data-action='translate']");
    expect(ports).toHaveLength(3);
  });

  it("uses one panel structure for the selectable pearl and parchment skins", () => {
    const { controller } = setup();
    controller.setTheme("pearl");
    controller.show(reading("investigation", "word"), { bottom: 80, left: 40, top: 60 });
    const pearl = shadow().querySelector<HTMLElement>(".panel");
    expect(pearl?.dataset.theme).toBe("pearl");
    const pearlStructure = pearl?.innerHTML;

    controller.setTheme("parchment");
    expect(pearl?.dataset.theme).toBe("parchment");
    controller.show(reading("investigation", "word"), { bottom: 80, left: 40, top: 60 });
    const parchment = shadow().querySelector<HTMLElement>(".panel");
    expect(parchment?.dataset.theme).toBe("parchment");
    expect(parchment?.innerHTML).toBe(pearlStructure);
  });

  it("loads the packaged Shadow stylesheet and keeps an operable fallback on failure", () => {
    const { controller } = setup();
    controller.show(reading("investigation", "word"), { bottom: 80, left: 40, top: 60 });
    const stylesheet = shadow().querySelector<HTMLLinkElement>("[data-overlay-stylesheet]");
    const panel = shadow().querySelector<HTMLElement>(".panel");
    expect(stylesheet?.href).toBe("chrome-extension://test/overlay.css");
    expect(panel?.dataset.styles).toBe("loading");
    stylesheet?.dispatchEvent(new Event("error"));
    expect(panel?.dataset.styles).toBe("fallback");
    expect(shadow().querySelectorAll("[data-action]")).toHaveLength(2);
    expect(shadow().querySelector("style")?.textContent).toContain("min-height:40px");
  });

  it.each(["pearl", "parchment"] as const)(
    "never displays the selected text in the %s initial card",
    (theme) => {
      const { controller } = setup();
      controller.setTheme(theme);
      controller.show(reading("private selected phrase", "phrase"), {
        bottom: 80,
        left: 40,
        top: 60,
      });

      expect(shadow().querySelector("[data-selection]")).toBeNull();
      expect(shadow().textContent).not.toContain("private selected phrase");
      expect(shadow().querySelectorAll("[data-action]")).toHaveLength(2);
    },
  );

  it("renders the initial ActionCard as two compact actions without the ResultCard brand shell", () => {
    const { controller } = setup();
    controller.show(reading("missing", "word"), { bottom: 80, left: 40, top: 60 });

    const panel = shadow().querySelector<HTMLElement>(".panel");
    expect(panel?.dataset.card).toBe("action");
    expect(shadow().querySelector(".brand-mark")).toBeNull();
    expect(shadow().querySelector(".eyebrow")).toBeNull();
    expect(shadow().querySelectorAll("[data-action]")).toHaveLength(2);
    expect(panel?.textContent).toBe("翻译解释");
  });

  it("starts the trusted migrated default action without hiding the manual choices", () => {
    const { controller, ports } = setup();
    controller.setDefaultAction("explain");
    controller.show(reading("investigation", "word"), { bottom: 80, left: 40, top: 60 });

    expect(shadow().querySelectorAll("[data-action]")).toHaveLength(2);
    expect(ports).toHaveLength(1);
    expect(ports[0]?.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: "explain", type: "store/analysis-start" }),
    );
  });

  it("opens one strict port, renders ordered deltas and a terminal result", () => {
    const { controller, ports } = setup();
    controller.show(reading("early stages", "phrase"), { bottom: 80, left: 40, top: 60 });
    click("[data-action='translate']");

    expect(ports).toHaveLength(1);
    expect(ports[0]?.postMessage).toHaveBeenCalledWith({
      action: "translate",
      boundaryEvidence: { kind: "local-rules" },
      messageVersion: STORE_MESSAGE_VERSION,
      selection: "early stages",
      sentenceContext: "Sentence with early stages.",
      type: "store/analysis-start",
    });
    ports[0]?.receive({
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/analysis-update",
      update: {
        requestId: "request-1",
        section: "translation",
        sequence: 0,
        text: "早期",
        type: "delta",
      },
    });
    ports[0]?.receive({
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/analysis-update",
      update: {
        requestId: "request-1",
        section: "translation",
        sequence: 1,
        text: "阶段",
        type: "delta",
      },
    });
    expect(shadow().querySelector("[data-analysis-body]")?.textContent).toContain("早期阶段");

    ports[0]?.receive({
      messageVersion: STORE_MESSAGE_VERSION,
      result: {
        collocations: [],
        contextualMeaningZh: "早期阶段",
        partOfSpeech: "phrase",
        requestId: "request-1",
        selectionKind: "phrase",
        similarTerms: [],
        sourceText: "early stages",
        type: "translate-lexical",
      },
      type: "store/analysis-result",
    });
    expect(shadow().querySelector("[data-analysis-body]")?.textContent).toContain("早期阶段");
    expect(ports[0]?.disconnect).toHaveBeenCalledOnce();
  });

  it("does not let the host page synthesize a paid analysis action", () => {
    const { controller, ports } = setup(false);
    controller.show(reading("investigation", "word"), { bottom: 80, left: 40, top: 60 });

    click("[data-action='translate']");

    expect(ports).toHaveLength(0);
  });

  it("maps actionable errors, opens settings safely, and retries only after a click", () => {
    const { controller, openOptions, ports } = setup();
    controller.show(reading("investigation", "word"), { bottom: 80, left: 40, top: 60 });
    click("[data-action='explain']");
    ports[0]?.receive({
      code: "credential-missing",
      messageVersion: STORE_MESSAGE_VERSION,
      requestId: null,
      type: "store/analysis-error",
    });

    expect(shadow().querySelector("[role='alert']")?.textContent).toContain("尚未配置密钥");
    expect(ports).toHaveLength(1);
    click("[data-open-options]");
    expect(openOptions).toHaveBeenCalledOnce();
    click("[data-retry]");
    expect(ports).toHaveLength(2);
  });

  it("turns an Options opening rejection into a visible error", async () => {
    const { controller, openOptions, ports } = setup();
    openOptions.mockRejectedValueOnce(new Error("Extension context invalidated"));
    controller.show(reading("investigation", "word"), { bottom: 80, left: 40, top: 60 });
    click("[data-action='translate']");
    ports[0]?.receive({
      code: "consent-required",
      messageVersion: STORE_MESSAGE_VERSION,
      requestId: null,
      type: "store/analysis-error",
    });

    click("[data-open-options]");
    await Promise.resolve();
    expect(shadow().querySelector("[role='alert']")?.textContent).toContain("扩展暂时无法完成分析");
  });

  it("cancels on close and new selection without auto-retry", () => {
    const { controller, ports } = setup();
    controller.show(reading("investigation", "word"), { bottom: 80, left: 40, top: 60 });
    click("[data-action='translate']");
    controller.show(reading("evidence", "word"), { bottom: 120, left: 60, top: 100 });
    expect(ports[0]?.postMessage).toHaveBeenLastCalledWith({
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/analysis-cancel",
    });
    expect(ports).toHaveLength(1);

    click("[data-action='translate']");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(ports[1]?.postMessage).toHaveBeenLastCalledWith({
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/analysis-cancel",
    });
    expect(document.querySelector("[data-huayi-store-overlay]")).toBeNull();
  });

  it("dismisses on a trusted outside pointerdown and clears the document selection", () => {
    const { controller } = setup();
    const paragraph = document.createElement("p");
    paragraph.textContent = "The investigation began.";
    const outside = document.createElement("button");
    document.body.append(paragraph, outside);
    const selection = selectText(paragraph, "investigation");
    const onDismiss = vi.fn();
    controller.show(reading("investigation", "word"), { bottom: 80, left: 40, top: 60 }, onDismiss);

    outside.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }));

    expect(document.querySelector("[data-huayi-store-overlay]")).toBeNull();
    expect(selection.rangeCount).toBe(0);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("does not dismiss for pointerdown inside the shadow overlay", () => {
    const { controller } = setup();
    const onDismiss = vi.fn();
    controller.show(reading("investigation", "word"), { bottom: 80, left: 40, top: 60 }, onDismiss);
    const action = shadow().querySelector<HTMLButtonElement>("[data-action='translate']");
    if (action === null) throw new Error("Missing overlay action.");

    action.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }));

    expect(document.querySelector("[data-huayi-store-overlay]")).not.toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("does not let the host page synthesize an outside dismissal", () => {
    const { controller } = setup(false);
    const outside = document.createElement("button");
    document.body.append(outside);
    const onDismiss = vi.fn();
    controller.show(reading("investigation", "word"), { bottom: 80, left: 40, top: 60 }, onDismiss);

    outside.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }));

    expect(document.querySelector("[data-huayi-store-overlay]")).not.toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("replaces an overlay without clearing the new selection or reporting a dismissal", () => {
    const { controller } = setup();
    const paragraph = document.createElement("p");
    paragraph.textContent = "The evidence remained inconclusive.";
    document.body.append(paragraph);
    const onDismiss = vi.fn();
    controller.show(reading("evidence", "word"), { bottom: 80, left: 40, top: 60 }, onDismiss);
    const selection = selectText(paragraph, "inconclusive");

    controller.show(
      reading("inconclusive", "word"),
      { bottom: 120, left: 60, top: 100 },
      onDismiss,
    );

    expect(selection.toString()).toBe("inconclusive");
    expect(onDismiss).not.toHaveBeenCalled();
    expect(shadow().querySelector("[data-selection]")).toBeNull();
    expect(shadow().textContent).not.toContain("inconclusive");
  });

  it("separates an owner clear from a user dismissal", () => {
    const { controller } = setup();
    const paragraph = document.createElement("p");
    paragraph.textContent = "The investigation began.";
    paragraph.tabIndex = 0;
    document.body.append(paragraph);
    paragraph.focus();
    const selection = selectText(paragraph, "investigation");
    const onDismiss = vi.fn();
    controller.show(reading("investigation", "word"), { bottom: 80, left: 40, top: 60 }, onDismiss);

    controller.close("owner-clear");

    expect(document.querySelector("[data-huayi-store-overlay]")).toBeNull();
    expect(selection.rangeCount).toBe(0);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(paragraph);
  });

  it.each([
    ["version-mismatch", "扩展已更新"],
    ["network-error", "网络连接失败"],
  ] as const)("renders a stable %s message", (code, expected) => {
    const { controller, ports } = setup();
    controller.show(reading("evidence", "word"), { bottom: 80, left: 40, top: 60 });
    click("[data-action='translate']");
    ports[0]?.receive({
      code,
      messageVersion: STORE_MESSAGE_VERSION,
      requestId: null,
      type: "store/analysis-error",
    });
    expect(shadow().querySelector("[role='alert']")?.textContent).toContain(expected);
  });

  it("fails closed on malformed messages and unexpected disconnects", () => {
    const { controller, ports } = setup();
    controller.show(reading("evidence", "word"), { bottom: 80, left: 40, top: 60 });
    click("[data-action='translate']");
    ports[0]?.receive({ type: "store/analysis-result", html: "<img src=x>" });
    expect(shadow().querySelector("[role='alert']")?.textContent).toContain("无效响应");

    click("[data-retry]");
    ports[1]?.drop();
    expect(shadow().querySelector("[role='alert']")?.textContent).toContain("连接已中断");
  });
});
