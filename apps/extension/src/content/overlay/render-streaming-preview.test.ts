import { describe, expect, it } from "vitest";

import type { ErrorOverlayState, StreamingOverlayState } from "./overlay-state.js";
import { renderStreamingPreview } from "./render-streaming-preview.js";
import { session } from "./render-result.test-fixtures.js";

function streamingState(preview: StreamingOverlayState["preview"]): StreamingOverlayState {
  return { ...session, preview, status: "streaming" };
}

describe("renderStreamingPreview", () => {
  it("renders the source above populated preview sections with their Chinese titles", () => {
    const preview = renderStreamingPreview(
      streamingState({
        lastSequence: 3,
        sections: {
          "context-role": "补充背景",
          "contextual-meaning": "既定的",
          "main-structure": "term + is saved",
          translation: "这个既定术语已保存。",
        },
      }),
    );
    const source = preview.querySelector(".huayi-source");
    const headings = Array.from(preview.querySelectorAll(".huayi-section-title"));

    expect(source?.textContent).toBe("Selection");
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "语境义",
      "译文",
      "句子主干",
      "语境作用",
    ]);
    const firstHeading = headings[0];
    if (source === null || firstHeading === undefined) {
      throw new Error("Expected the source and at least one preview heading.");
    }
    expect(
      source.compareDocumentPosition(firstHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows the spinner only before the first delta", () => {
    const waiting = renderStreamingPreview(streamingState({ lastSequence: -1, sections: {} }));
    const started = renderStreamingPreview(
      streamingState({ lastSequence: 0, sections: { translation: "部分译文" } }),
    );

    expect(waiting.querySelector(".huayi-spinner")).not.toBeNull();
    expect(started.querySelector(".huayi-spinner")).toBeNull();
  });

  it("retains a read-only preview and marks it incomplete after an analysis error", () => {
    const state: ErrorOverlayState = {
      ...session,
      error: { code: "TIMEOUT", message: "处理超时，请重试。", retryable: true },
      preview: { lastSequence: 0, sections: { translation: "部分译文" } },
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
        lastSequence: 0,
        sections: { "contextual-meaning": malicious },
      }),
      selection: { ...session.selection, selection: malicious },
    });

    expect(preview.textContent).toContain(malicious);
    expect(preview.querySelector("img")).toBeNull();
  });
});
