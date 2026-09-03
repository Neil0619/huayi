import { beforeEach, describe, expect, it } from "vitest";

import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";

import { click, reading, setup, shadow } from "./store-overlay-controller.test-support.js";

function completePhraseResult(ports: ReturnType<typeof setup>["ports"]): void {
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
}

describe("Store overlay cloud workspace entry", () => {
  beforeEach(() => {
    document.body.textContent = "";
  });

  it("does not append a misleading Web-workspace footer to a completed result", () => {
    const { controller, openWebWorkspace, ports } = setup();
    controller.show(reading("early stages", "phrase"), { bottom: 80, left: 40, top: 60 });
    click("[data-action='translate']");
    completePhraseResult(ports);

    expect(shadow().querySelector(".cloud-workspace")).toBeNull();
    expect(shadow().textContent).not.toContain("整理与收藏在 Web 完成");
    expect(shadow().querySelector("[data-open-web-workspace]")).toBeNull();
    expect(shadow().querySelector("[data-candidate-form]")).toBeNull();
    expect(openWebWorkspace).not.toHaveBeenCalled();
  });
});
