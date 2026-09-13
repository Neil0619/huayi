import { analysisEventReadSchema, type AnalysisEventRead } from "@huayi/cloud-contracts";
import { describe, expect, it } from "vitest";
import { analysisModuleFixture } from "./test-support/analysis-module-fixture.js";
import { structuredAnalysisFixture } from "./test-support/structured-analysis-fixture.js";
import { analysisSourceUnits } from "./analysis-segmentation.js";

async function collect(events: AsyncIterable<AnalysisEventRead>) {
  const result: AnalysisEventRead[] = [];
  for await (const event of events) result.push(analysisEventReadSchema.parse(event));
  return result;
}
function setup() {
  const content = structuredAnalysisFixture();
  const fixture = analysisModuleFixture(content);
  const input = {
    outputContract: "structured-teaching-v1" as const,
    sourceText: "  We can.\r\n",
    selectionKind: "sentence" as const,
    source: { type: "manual" as const },
  };
  return { ...fixture, input };
}

describe("native analysis generation lifecycle", () => {
  it("saves exact original text and coherent UUID mappings, emitting each complete structure once", async () => {
    const f = setup();
    const events = await collect(
      f.module.startPlatformAnalysis({ userId: "owner", idempotencyKey: "native", input: f.input }),
    );
    expect(events.map((e) => e.type)).toEqual([
      "analysis.started",
      "analysis.preview",
      "analysis.structure",
      "analysis.completed",
    ]);
    const done = events.find((e) => e.type === "analysis.completed");
    if (!done) throw new Error("Missing native result.");
    expect(done.analysis.sourceText).toBe(f.input.sourceText);
    expect(done.analysis.result.type).toBe("sentence-passage-analysis-v3");
    expect(done.analysis.result).toMatchObject({
      recommendations: [{ candidateId: done.analysis.candidates[0]?.id }],
    });
    expect(await f.repository.findById("owner", done.analysis.id)).toEqual(done.analysis);
    const replay = await collect(
      f.module.startPlatformAnalysis({ userId: "owner", idempotencyKey: "native", input: f.input }),
    );
    expect(replay).toEqual([done]);
    const { outputContract, ...legacy } = f.input;
    void outputContract;
    await expect(
      f.module.preparePlatformAnalysis({
        userId: "owner",
        idempotencyKey: "native",
        input: legacy,
      }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("rejects a v3 result for old generation and an old result for native generation before saving", async () => {
    const f = setup();
    const { outputContract, ...legacy } = f.input;
    void outputContract;
    const oldEvents = await collect(
      f.module.startPlatformAnalysis({ userId: "owner", idempotencyKey: "old", input: legacy }),
    );
    expect(oldEvents.at(-1)).toMatchObject({
      type: "analysis.failed",
      error: { code: "model_output_invalid" },
    });
    const oldModel = analysisModuleFixture();
    const nativeEvents = await collect(
      oldModel.module.startPlatformAnalysis({
        userId: "owner",
        idempotencyKey: "new",
        input: f.input,
      }),
    );
    expect(nativeEvents.at(-1)).toMatchObject({
      type: "analysis.failed",
      error: { code: "model_output_invalid" },
    });
  });

  it("uses shared source partitions for native quoted sentences and preserves the old partitioner", () => {
    const sourceText = '"Go now."\r\nWe can.';
    const input = {
      sourceText,
      source: { type: "manual" as const },
      selectionKind: "passage" as const,
    };
    expect(
      analysisSourceUnits({ ...input, outputContract: "structured-teaching-v1" }).map(
        (u) => u.sourceText,
      ),
    ).toEqual(['"Go now."', "We can."]);
    expect(analysisSourceUnits(input)).toHaveLength(1);
  });

  it("does not reuse a legacy capture generation when only its output contract changes", async () => {
    const f = analysisModuleFixture();
    const command = {
      userId: "owner",
      captureId: "capture-1",
      idempotencyKey: "capture-contract",
      input: { expectedRevision: 1, intent: "initial" },
    };
    await collect(await f.module.prepareStudyCaptureAnalysis(command));
    await expect(
      f.module.prepareStudyCaptureAnalysis({
        ...command,
        input: { ...command.input, outputContract: "structured-teaching-v1" },
      }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(f.model.requests).toHaveLength(1);
  });
});
