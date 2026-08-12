import { beforeEach, describe, expect, it, vi } from "vitest";

import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";

import { click, reading, setup, shadow } from "./store-overlay-controller.test-support.js";

describe("Store overlay word presence", () => {
  beforeEach(() => {
    document.body.textContent = "";
  });

  it("keeps a stable result shell and places word save in the single header row", async () => {
    const { controller, ports } = setup();
    controller.show(reading("investigations", "word"), { bottom: 80, left: 40, top: 60 });
    const before = shadow().querySelector(".header");
    expect(shadow().querySelector("[data-save-word]")).toBeNull();

    click("[data-action='translate']");
    const checking = shadow().querySelector<HTMLButtonElement>("[data-save-word]");
    expect(checking).toMatchObject({ disabled: true, textContent: "生词" });
    expect(checking?.dataset.saveState).toBe("checking");
    expect(checking?.closest(".header")).not.toBeNull();
    expect(shadow().querySelector("[data-close]")).toBeNull();
    expect(shadow().querySelector(".eyebrow")?.textContent).toBe("HUAYI");
    ports[0]?.receive({
      messageVersion: STORE_MESSAGE_VERSION,
      result: {
        commonMeanings: [{ meaningsZh: ["调查"], partOfSpeech: "noun" }],
        commonPhrases: [],
        confusableWords: [],
        contextualSense: { meaningZh: "调查工作", partOfSpeech: "noun" },
        dictionaryForm: "investigation",
        requestId: "request-word",
        selectionKind: "word",
        sourceText: "investigations",
        type: "translate-word",
      },
      type: "store/analysis-result",
    });

    expect(shadow().querySelector(".header")).toBe(before);
    const available = shadow().querySelector<HTMLButtonElement>("[data-save-word]");
    expect(available).toMatchObject({ disabled: false, textContent: "生词" });
    expect(available?.dataset.saveState).toBe("available");
    expect(shadow().querySelector(".body > .lexicon-save")).toBeNull();
    available?.click();
    expect(available?.dataset.saveState).toBe("saving");
    await vi.waitFor(() => expect(available?.dataset.saveState).toBe("saved"));
    expect(available).toMatchObject({ disabled: true, textContent: "已保存" });

    click("[data-action='explain']");
    click("[data-action='translate']");
    expect(shadow().querySelector<HTMLButtonElement>("[data-save-word]")).toMatchObject({
      disabled: true,
      textContent: "已保存",
    });
  });

  it.each(["phrase", "sentence"] as const)(
    "never shows a word-save action for a %s selection",
    (kind) => {
      const { controller } = setup();
      controller.show(reading(kind === "phrase" ? "early stages" : "It began.", kind), {
        bottom: 80,
        left: 40,
        top: 60,
      });
      expect(shadow().querySelector("[data-save-word]")).toBeNull();
    },
  );

  it("reconciles selection and canonical presence without letting stale results overwrite", async () => {
    const pending: ((value: unknown) => void)[] = [];
    const { controller, ports, queryWordPresence } = setup();
    queryWordPresence.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    controller.show(reading("investigations", "word"), { bottom: 80, left: 40, top: 60 });
    click("[data-action='translate']");
    expect(queryWordPresence).toHaveBeenCalledWith({
      headword: "investigations",
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/lexicon-presence",
    });

    ports[0]?.receive({
      messageVersion: STORE_MESSAGE_VERSION,
      result: {
        commonMeanings: [{ meaningsZh: ["调查"], partOfSpeech: "noun" }],
        commonPhrases: [],
        confusableWords: [],
        contextualSense: { meaningZh: "调查", partOfSpeech: "noun" },
        dictionaryForm: "investigation",
        requestId: "canonical",
        selectionKind: "word",
        sourceText: "investigations",
        type: "translate-word",
      },
      type: "store/analysis-result",
    });
    expect(queryWordPresence).toHaveBeenLastCalledWith({
      headword: "investigation",
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/lexicon-presence",
    });
    pending[1]?.({
      messageVersion: STORE_MESSAGE_VERSION,
      present: false,
      type: "store/lexicon-presence-result",
    });
    await vi.waitFor(() =>
      expect(shadow().querySelector("[data-save-word]")?.getAttribute("data-save-state")).toBe(
        "available",
      ),
    );
    pending[0]?.({
      messageVersion: STORE_MESSAGE_VERSION,
      present: true,
      type: "store/lexicon-presence-result",
    });
    await Promise.resolve();
    expect(shadow().querySelector("[data-save-word]")?.getAttribute("data-save-state")).toBe(
      "available",
    );
  });
});
