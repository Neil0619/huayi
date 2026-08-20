import type { ExtensionQueryEvent } from "@huayi/cloud-contracts";
import type { AnalysisRequest } from "@huayi/store-domain";
import { describe, expect, it, vi } from "vitest";

import { CloudExtensionQueryError } from "./cloud-extension-query-api.js";
import { createPlatformAnalysisEngine } from "./platform-analysis-engine.js";

const request: AnalysisRequest = {
  action: "explain",
  providerId: "openai",
  requestId: "local-request-1",
  selection: "The plan fell through.",
  selectionKind: "sentence",
  sentenceContext: null,
  targetLanguage: "zh-CN",
};
const signal = new AbortController().signal;

describe("platform analysis engine", () => {
  it("maps a platform completion to the local compact result without sending provider fields", async () => {
    const start = vi.fn(async function* (input: unknown) {
      expect(input).toEqual({
        action: "explain",
        selectionKind: "sentence",
        sourceText: "The plan fell through.",
        sourceType: "youtube-caption",
      });
      yield { generationId: "generation-1", type: "query.started" as const };
      yield {
        generationId: "generation-1",
        quota: {
          availableMicroUsd: 900,
          limitMicroUsd: 1_000,
          percentUsed: 10,
          periodEnd: "2026-09-01T00:00:00.000Z",
          periodStart: "2026-08-01T00:00:00.000Z",
          reservedMicroUsd: 0,
          usedMicroUsd: 100,
          warning: "available" as const,
        },
        result: {
          contextRole: "谓语",
          keyExpressions: [{ meaningZh: "落空", text: "fell through" }],
          mainStructure: "主语 + 谓语",
          requestId: "generation-1",
          selectionKind: "sentence" as const,
          sourceText: "The plan fell through.",
          translationZh: "计划落空了。",
          type: "explain-sentence" as const,
        },
        type: "query.completed" as const,
      };
    });
    const engine = createPlatformAnalysisEngine({
      api: { start },
      readSession: async () => ({ token: "s".repeat(32) }),
      sourceType: "youtube-caption",
    });
    const updates: unknown[] = [];

    const result = await engine.analyze(request, signal, (update) => updates.push(update));

    expect(result).toMatchObject({
      requestId: "local-request-1",
      sourceText: "The plan fell through.",
      type: "explain-sentence",
    });
    expect(updates).toEqual([{ requestId: "local-request-1", stage: "running", type: "progress" }]);
    expect(start).toHaveBeenCalledWith(
      expect.anything(),
      "local-request-1",
      "s".repeat(32),
      expect.any(AbortSignal),
    );
  });

  it("fails closed for exhausted quota without calling a local engine", async () => {
    const engine = createPlatformAnalysisEngine({
      api: {
        start: async function* () {
          yield* [] as ExtensionQueryEvent[];
          throw new CloudExtensionQueryError("quota-exhausted");
        },
      },
      readSession: async () => ({ token: "s".repeat(32) }),
      sourceType: "web-selection",
    });

    await expect(engine.analyze(request, signal, () => undefined)).rejects.toMatchObject({
      code: "quota-exhausted",
    });
  });
});
