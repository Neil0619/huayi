import { beforeEach, describe, expect, it } from "vitest";

import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";

import { click, reading, setup, shadow } from "./store-overlay-controller.test-support.js";

function startWord() {
  const setupResult = setup();
  setupResult.controller.show(reading("missing", "word"), { bottom: 80, left: 40, top: 60 });
  click("[data-action='translate']");
  return setupResult;
}

function contextualSense(meaningZh: string) {
  return {
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/analysis-update" as const,
    update: {
      requestId: "request-1",
      section: "contextual-sense" as const,
      sequence: 0,
      type: "section" as const,
      value: { meaningZh, partOfSpeech: "adjective" as const },
    },
  };
}

describe("Store overlay streaming", () => {
  beforeEach(() => {
    document.body.textContent = "";
  });

  it("renders Classic structured word sections progressively in a stable ResultCard shell", () => {
    const { ports } = startWord();
    const body = shadow().querySelector<HTMLElement>("[data-analysis-body]");
    ports[0]?.receive(contextualSense("在语境中表示失踪的"));
    const firstSection = shadow().querySelector("[data-result-section='contextual-sense']");
    ports[0]?.receive({
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/analysis-update",
      update: {
        requestId: "request-1",
        section: "common-meanings",
        sequence: 1,
        type: "section",
        value: [{ meaningsZh: ["失踪的", "缺少的"], partOfSpeech: "adjective" }],
      },
    });

    expect(shadow().querySelector("[data-analysis-body]")).toBe(body);
    expect(shadow().querySelector("[data-result-section='contextual-sense']")).toBe(firstSection);
    expect(shadow().textContent).toContain("失踪的；缺少的");
    expect(shadow().querySelector("[data-brand-mark]")).not.toBeNull();
  });

  it("keeps the Classic loading skeleton until the first preview update", () => {
    const { ports } = startWord();
    expect(shadow().querySelector("[data-loading-skeleton]")).not.toBeNull();
    ports[0]?.receive(contextualSense("失踪的"));
    expect(shadow().querySelector("[data-loading-skeleton]")).toBeNull();
  });

  it.each(["error", "disconnect"] as const)(
    "keeps validated partial sections when a stream ends with %s",
    (ending) => {
      const { ports } = startWord();
      ports[0]?.receive(contextualSense("失踪的"));
      const partial = shadow().querySelector("[data-result-section='contextual-sense']");
      if (ending === "error") {
        ports[0]?.receive({
          code: "invalid-response",
          messageVersion: STORE_MESSAGE_VERSION,
          requestId: "request-1",
          type: "store/analysis-error",
        });
      } else {
        ports[0]?.drop();
      }

      expect(shadow().querySelector("[data-result-section='contextual-sense']")).toBe(partial);
      expect(shadow().textContent).toContain("内容未完整生成");
      expect(shadow().querySelector("[data-retry]")).not.toBeNull();
    },
  );
});
