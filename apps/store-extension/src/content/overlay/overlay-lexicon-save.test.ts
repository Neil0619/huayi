import {
  STORE_MESSAGE_VERSION,
  type AnalysisResult,
  type StoreLexiconSaveRequest,
} from "@huayi/store-domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { appendWordLexiconSaveAction } from "./overlay-lexicon-save.js";

function wordResult(type: "explain-word" | "translate-word"): AnalysisResult {
  return type === "translate-word"
    ? {
        commonMeanings: [{ meaningsZh: ["调查"], partOfSpeech: "noun" }],
        commonPhrases: [],
        confusableWords: [],
        contextualSense: { meaningZh: "调查工作", partOfSpeech: "noun" },
        dictionaryForm: "investigation",
        requestId: "request-1",
        selectionKind: "word",
        sourceText: "investigations",
        type,
      }
    : {
        contextualAnalysisZh: "此处表示正在进行的调查。",
        requestId: "request-1",
        selectionKind: "word",
        sourceText: "investigations",
        synonyms: [],
        type,
        usageNotes: [],
        wordForm: { baseForm: "investigation", formTypeZh: "名词复数" },
      };
}

function terminal(status: "duplicate" | "saved"): unknown {
  return { messageVersion: STORE_MESSAGE_VERSION, status, type: "store/lexicon-save-result" };
}

describe("Overlay local lexicon save action", () => {
  beforeEach(() => {
    document.body.textContent = "";
  });

  it.each([
    ["translate-word", "调查工作"],
    ["explain-word", "此处表示正在进行的调查。"],
  ] as const)("saves a %s result after a trusted click", async (type, meaning) => {
    const send = vi.fn(async () => terminal("saved"));
    appendWordLexiconSaveAction({
      acceptsUserGesture: () => true,
      container: document.body,
      result: wordResult(type),
      send,
      sentence: "The investigations continued.",
    });

    document.querySelector<HTMLButtonElement>("[data-save-word]")?.click();
    expect(document.querySelector<HTMLButtonElement>("[data-save-word]")?.disabled).toBe(true);
    document.querySelector<HTMLButtonElement>("[data-save-word]")?.click();
    expect(send).toHaveBeenCalledOnce();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-save-status]")?.textContent).toBe(
        "已保存到本地生词本。",
      ),
    );
    expect(document.querySelector<HTMLButtonElement>("[data-save-word]")).toMatchObject({
      disabled: true,
      textContent: "已保存",
    });
    expect(send).toHaveBeenCalledWith({
      contextualMeaningZh: meaning,
      headword: "investigation",
      messageVersion: STORE_MESSAGE_VERSION,
      sentence: "The investigations continued.",
      type: "store/lexicon-save",
    } satisfies StoreLexiconSaveRequest);
  });

  it("renders a stable completed state for an idempotent duplicate", async () => {
    appendWordLexiconSaveAction({
      acceptsUserGesture: () => true,
      container: document.body,
      result: wordResult("translate-word"),
      send: async () => terminal("duplicate"),
      sentence: "The investigations continued.",
    });

    document.querySelector<HTMLButtonElement>("[data-save-word]")?.click();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-save-status]")?.textContent).toBe(
        "这个语境已经保存过。",
      ),
    );
    expect(document.querySelector<HTMLButtonElement>("[data-save-word]")).toMatchObject({
      disabled: true,
      textContent: "已保存",
    });
  });

  it("returns failures to a retryable save action without throwing", async () => {
    const outcomes = [
      {
        code: "data-corrupt",
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/lexicon-error",
      },
      { html: "bad" },
    ];
    const send = vi.fn(async () => outcomes.shift());
    appendWordLexiconSaveAction({
      acceptsUserGesture: () => true,
      container: document.body,
      result: wordResult("translate-word"),
      send,
      sentence: "The investigations continued.",
    });
    const button = document.querySelector<HTMLButtonElement>("[data-save-word]");

    for (const expected of [
      "本地生词数据可能已损坏，请清除扩展数据后重试。",
      "保存失败，请稍后重试。",
    ]) {
      button?.click();
      await vi.waitFor(() =>
        expect(document.querySelector("[data-save-status]")?.textContent).toBe(expected),
      );
      expect(button).toMatchObject({ disabled: false, textContent: "生词" });
      expect(button?.dataset.saveState).toBe("error");
    }
  });

  it("creates a fresh action for a replacement analysis result", async () => {
    const previous = document.createElement("div");
    document.body.append(previous);
    appendWordLexiconSaveAction({
      acceptsUserGesture: () => true,
      container: previous,
      result: wordResult("translate-word"),
      send: async () => terminal("saved"),
      sentence: "The investigations continued.",
    });
    previous.querySelector<HTMLButtonElement>("[data-save-word]")?.click();
    await vi.waitFor(() =>
      expect(previous.querySelector<HTMLButtonElement>("[data-save-word]")).toMatchObject({
        disabled: true,
        textContent: "已保存",
      }),
    );

    previous.remove();
    const replacement = document.createElement("div");
    document.body.append(replacement);
    appendWordLexiconSaveAction({
      acceptsUserGesture: () => true,
      container: replacement,
      result: wordResult("explain-word"),
      send: async () => terminal("saved"),
      sentence: "The investigations continued.",
    });

    expect(replacement.querySelector<HTMLButtonElement>("[data-save-word]")).toMatchObject({
      disabled: false,
      textContent: "生词",
    });
  });

  it("does not render for phrase results or accept synthetic actions", () => {
    const send = vi.fn(async () => terminal("saved"));
    appendWordLexiconSaveAction({
      acceptsUserGesture: () => false,
      container: document.body,
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
      send,
      sentence: "It is in the early stages.",
    });
    expect(document.querySelector("[data-save-word]")).toBeNull();

    appendWordLexiconSaveAction({
      acceptsUserGesture: () => false,
      container: document.body,
      result: wordResult("translate-word"),
      send,
      sentence: "The investigations continued.",
    });
    document.querySelector<HTMLButtonElement>("[data-save-word]")?.click();
    expect(send).not.toHaveBeenCalled();
  });
});
