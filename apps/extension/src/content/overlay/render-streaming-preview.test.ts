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
          collocations: [{ meaningZh: "数字四", text: "number four" }],
          contextExample: { english: "Four remain.", translationZh: "还剩四个。" },
          partOfSpeech: "number",
          pronunciation: { uk: "/fɔː/" },
          similarTerms: [{ meaningZh: "四个", partOfSpeech: "number", text: "four" }],
        },
        text: { "contextual-meaning": "四" },
      }),
    );
    const source = preview.querySelector(".huayi-source");
    const headings = Array.from(preview.querySelectorAll(".huayi-section-title"));

    expect(source?.textContent).toBe("Selection");
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "语境义",
      "词性",
      "音标",
      "语境搭配",
      "原文例句",
      "相似词",
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
          collocations: [{ meaningZh: "四个项目", text: "four items" }],
          synonyms: [{ meaningZh: "四个", partOfSpeech: "number", text: "four" }],
          wordFormation: "来自古英语",
          coreMeanings: [{ meaningZh: "四", partOfSpeech: "number" }],
          baseForm: "four",
        },
        text: { "contextual-meaning": "四" },
      }),
      action: "explain",
    });

    expect(
      Array.from(
        preview.querySelectorAll(".huayi-section-title"),
        (heading) => heading.textContent,
      ),
    ).toEqual(["语境义", "原形", "构词", "核心词义", "语境搭配", "同义词"]);
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
        sections: { partOfSpeech: "noun" },
        text: { translation: "部分译文" },
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
          collocations: [{ meaningZh: malicious, text: malicious }],
        },
        text: { "contextual-meaning": malicious },
      }),
      selection: { ...session.selection, selection: malicious },
    });

    expect(preview.textContent).toContain(malicious);
    expect(preview.querySelector("img")).toBeNull();
  });
});
