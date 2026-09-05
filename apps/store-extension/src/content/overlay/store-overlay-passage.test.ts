import { beforeEach, describe, expect, it } from "vitest";

import {
  STORE_MESSAGE_VERSION,
  type AnalysisAction,
  type AnalysisResult,
} from "@huayi/store-domain";

import { createPlatformAnalysisEngine } from "../../service-worker/platform-analysis-engine.js";
import { readStoreSelection } from "../selection/read-selection.js";
import { click, selectText, setup, shadow } from "./store-overlay-controller.test-support.js";

const passage =
  "Hundreds of people are trying to contain the fire, which Moreno said appeared to have been caused by a downed power line. The flames then spread in a wooded area around Los Gallardos, Almería.";
const translation = "数百人正试图控制火势。随后，火焰蔓延到了附近的林地。";
const quota = {
  availableMicroUsd: 900,
  limitMicroUsd: 1_000,
  percentUsed: 10,
  periodEnd: "2026-09-01T00:00:00.000Z",
  periodStart: "2026-08-01T00:00:00.000Z",
  reservedMicroUsd: 0,
  usedMicroUsd: 100,
  warning: "available" as const,
};

function passageResult(action: AnalysisAction): AnalysisResult {
  const common = {
    requestId: "generation-passage",
    selectionKind: "passage" as const,
    sourceText: passage,
    translationZh: translation,
  };
  return action === "translate"
    ? { ...common, type: "translate-passage" }
    : {
        ...common,
        contextRole: "交代救火与火势扩散的情况。",
        keyExpressions: [{ meaningZh: "控制火势", text: "contain the fire" }],
        mainStructure: "第一句说明救火行动，第二句说明火势蔓延。",
        type: "explain-sentence",
      };
}

function showPassage() {
  const paragraph = document.createElement("p");
  paragraph.textContent = passage;
  document.body.append(paragraph);
  const selection = readStoreSelection(selectText(paragraph, passage));
  if (selection === null) throw new Error("Expected a selected passage.");
  expect(selection.selectionKind).toBe("passage");
  expect(selection.sentenceContext).toBeNull();
  const harness = setup();
  harness.controller.show(selection, { bottom: 80, left: 40, top: 60 });
  return harness;
}

describe("Store paragraph result delivery", () => {
  beforeEach(() => {
    document.body.textContent = "";
    window.getSelection()?.removeAllRanges();
  });

  it.each(["translate", "explain"] as const)(
    "renders a completed platform %s result for the actual multi-sentence selection",
    async (action) => {
      const { controller, ports } = showPassage();
      click(`[data-action='${action}']`);
      const port = ports[0];
      if (port === undefined) throw new Error("Missing analysis port.");
      const engine = createPlatformAnalysisEngine({
        api: {
          start: async function* () {
            yield { generationId: "generation-passage", type: "query.started" };
            yield {
              generationId: "generation-passage",
              quota,
              result: passageResult(action),
              type: "query.completed",
            };
          },
        },
        readSession: async () => ({ token: "s".repeat(32) }),
        sourceType: "web-selection",
      });
      const result = await engine.analyze(
        {
          action,
          providerId: "deepseek",
          requestId: "local-passage",
          selection: passage,
          selectionKind: "passage",
          sentenceContext: null,
          targetLanguage: "zh-CN",
        },
        new AbortController().signal,
        (update) =>
          port.receive({
            messageVersion: STORE_MESSAGE_VERSION,
            type: "store/analysis-update",
            update,
          }),
      );
      port.receive({
        messageVersion: STORE_MESSAGE_VERSION,
        result,
        type: "store/analysis-result",
      });

      expect(shadow().querySelector("[role='alert']")).toBeNull();
      expect(shadow().querySelector("[data-analysis-body]")?.textContent).toContain(translation);
      expect(shadow().querySelector("[data-result-type]")?.getAttribute("data-result-type")).toBe(
        action === "translate" ? "translate-passage" : "explain-sentence",
      );
      controller.close();
    },
  );

  it.each(["translate", "explain"] as const)(
    "still rejects a sentence %s result delivered for a selected passage",
    (action) => {
      const { controller, ports } = showPassage();
      click(`[data-action='${action}']`);
      ports[0]?.receive({
        messageVersion: STORE_MESSAGE_VERSION,
        result: { ...passageResult(action), selectionKind: "sentence" },
        type: "store/analysis-result",
      });

      expect(shadow().querySelector("[role='alert']")?.textContent).toContain("无效响应");
      expect(shadow().querySelector("[data-result-type]")).toBeNull();
      controller.close();
    },
  );
});
