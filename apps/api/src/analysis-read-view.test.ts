import {
  analysisRecordSchema,
  contractFixtures,
  structuredTeachingAccept,
} from "@huayi/cloud-contracts";
import { describe, expect, it } from "vitest";
import { createAnalysisReadView } from "./analysis-read-view.js";
import { structuredAnalysisFixture } from "./test-support/structured-analysis-fixture.js";
import { FakeAnalysisQuota } from "./test-support/analysis-fakes.js";

describe("analysis read representation", () => {
  it("checks the final event envelope even when the result itself fits its budget", () => {
    const quota = {
      ...new FakeAnalysisQuota().summary(),
      periodStart: `2026-08-01T00:00:00.${"0".repeat(70000)}Z`,
    };
    for (const accept of [undefined, structuredTeachingAccept.eventStream])
      expect(() =>
        createAnalysisReadView(accept).sse(
          { type: "analysis.completed", analysis: structuredAnalysisFixture(), quota },
          1,
        ),
      ).toThrow(/event exceeds/u);
  });
  it("does not negotiate an old saved result into invented structure", () => {
    expect(
      createAnalysisReadView(structuredTeachingAccept.json).record(
        analysisRecordSchema.parse(contractFixtures.analysis),
      ),
    ).toEqual(contractFixtures.analysis);
  });
});
