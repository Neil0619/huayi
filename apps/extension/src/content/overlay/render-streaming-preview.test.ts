import { describe, expect, it } from "vitest";

import type { ErrorOverlayState, StreamingOverlayState } from "./overlay-state.js";
import { renderStreamingPreview } from "./render-streaming-preview.js";
import { session } from "./render-result.test-fixtures.js";

function streamingState(preview: StreamingOverlayState["preview"]): StreamingOverlayState {
  return { ...session, preview, status: "streaming" };
}

describe("renderStreamingPreview", () => {
  it("renders lexical translation sections in fixed visual order", () => {
    const preview = renderStreamingPreview(
      streamingState({
        lastSequence: 6,
        sections: {
          commonMeanings: [{ meaningsZh: ["四"], partOfSpeech: "number" }],
          commonPhrases: [{ meaningZh: "四号", text: "number four" }],
          confusableWords: [
            {
              distinctionZh: "for 是介词。",
              meaningZh: "为了",
              partOfSpeech: "preposition",
              text: "for",
            },
          ],
          contextualSense: { meaningZh: "四", partOfSpeech: "number" },
          pronunciation: { uk: "/fɔː/" },
        },
        text: {},
      }),
    );
    const source = preview.querySelector(".huayi-source");
    const headings = Array.from(preview.querySelectorAll(".huayi-section-title"));

    expect(source?.textContent).toBe("Selection");
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "音标",
      "语境义",
      "常见释义",
      "常用短语",
      "易混词",
    ]);
    expect(
      Array.from(preview.querySelectorAll(".huayi-section"), (section) =>
        section.getAttribute("data-huayi-section"),
      ),
    ).toEqual([
      "pronunciation",
      "contextual-sense",
      "common-meanings",
      "common-phrases",
      "confusable-words",
    ]);
    const firstHeading = headings[0];
    if (source === null || firstHeading === undefined) {
      throw new Error("Expected the source and at least one preview heading.");
    }
    expect(
      source.compareDocumentPosition(firstHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders lexical explanation sections in fixed order regardless of object order", () => {
    const preview = renderStreamingPreview({
      ...streamingState({
        lastSequence: 6,
        sections: {
          synonymComparisons: [
            {
              distinctionZh: "quadruple 更强调四倍。",
              meaningZh: "四倍的",
              partOfSpeech: "adjective",
              text: "quadruple",
            },
          ],
          usageNotes: [{ descriptionZh: "可作限定词。", titleZh: "用法" }],
          wordForm: { baseForm: "four", formTypeZh: "基数词", sentenceRoleZh: "定语" },
          wordFormation: "来自古英语",
        },
        text: { "contextual-analysis": "此处表示数量四。" },
      }),
      action: "explain",
    });

    expect(
      Array.from(
        preview.querySelectorAll(".huayi-section-title"),
        (heading) => heading.textContent,
      ),
    ).toEqual(["语境解析", "词形解析", "构词解析", "用法要点", "同义词辨析"]);
  });

  it("shows the spinner only before the first analysis update", () => {
    const waiting = renderStreamingPreview(
      streamingState({ lastSequence: -1, sections: {}, text: {} }),
    );
    const started = renderStreamingPreview(
      streamingState({
        lastSequence: 0,
        sections: { partOfSpeech: "noun" },
        text: {},
      }),
    );

    expect(waiting.querySelector(".huayi-spinner")).not.toBeNull();
    expect(started.querySelector(".huayi-spinner")).toBeNull();
  });

  it("retains a read-only preview and marks it incomplete after an analysis error", () => {
    const state: ErrorOverlayState = {
      ...session,
      error: { code: "TIMEOUT", message: "处理超时，请重试。", retryable: true },
      preview: {
        lastSequence: 1,
        sections: { contextualSense: { meaningZh: "部分译文", partOfSpeech: "noun" } },
        text: {},
      },
      status: "error",
    };
    const preview = renderStreamingPreview(state);

    expect(preview.textContent).toContain("部分译文");
    expect(preview.querySelector(".huayi-preview-incomplete")?.textContent).toContain(
      "内容未完整生成",
    );
    expect(preview.querySelector("button")).toBeNull();
  });

  it("renders webpage and model strings as text without creating injected elements", () => {
    const malicious = '<img src=x onerror="globalThis.pwned=true">';
    const preview = renderStreamingPreview({
      ...streamingState({
        lastSequence: 1,
        sections: {
          commonPhrases: [{ meaningZh: malicious, text: malicious }],
          contextualSense: { meaningZh: malicious, partOfSpeech: "noun" },
        },
        text: {},
      }),
      selection: { ...session.selection, selection: malicious },
    });

    expect(preview.textContent).toContain(malicious);
    expect(preview.querySelector("img")).toBeNull();
  });
});
