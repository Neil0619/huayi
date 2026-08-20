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

  it("keeps candidate editing in Web and opens it through a parameter-free trusted command", async () => {
    const { controller, openWebWorkspace, ports } = setup();
    controller.show(reading("early stages", "phrase"), { bottom: 80, left: 40, top: 60 });
    click("[data-action='translate']");
    completePhraseResult(ports);

    expect(shadow().textContent).toContain("整理与收藏在 Web 完成");
    expect(shadow().querySelector("[data-candidate-form]")).toBeNull();
    click("[data-open-web-workspace]");
    await Promise.resolve();
    expect(openWebWorkspace).toHaveBeenCalledWith();
  });

  it("shows a stable cloud-entry error when the release URL is not configured", async () => {
    const { controller, openWebWorkspace, ports } = setup();
    openWebWorkspace.mockRejectedValueOnce(new Error("not configured"));
    controller.show(reading("early stages", "phrase"), { bottom: 80, left: 40, top: 60 });
    click("[data-action='translate']");
    completePhraseResult(ports);
    click("[data-open-web-workspace]");
    await Promise.resolve();
    await Promise.resolve();
    expect(shadow().querySelector("[role='alert']")?.textContent).toContain("暂时无法打开 Web");
  });
});
