import { analysisRecordSchema, contractFixtures } from "@huayi/cloud-contracts";
import { describe, expect, it } from "vitest";
import { validateAnalysisRecordForPersistence } from "./analysis-record-persistence.js";
import { createInMemoryAnalysisRepository } from "./analysis-repository.js";
import {
  structuredAnalysisAtCharacterLimit,
  structuredAnalysisFixture,
} from "./test-support/structured-analysis-fixture.js";

describe("analysis persistence metadata reserve", () => {
  it("preserves valid old and structured records exactly", () => {
    for (const record of [
      analysisRecordSchema.parse(contractFixtures.analysis),
      structuredAnalysisFixture(),
    ])
      expect(validateAnalysisRecordForPersistence(record)).toEqual(record);
  });
  it("rejects a readable boundary record before saving so archive/revision growth has room", async () => {
    const record = structuredAnalysisAtCharacterLimit();
    expect(() => validateAnalysisRecordForPersistence(record)).toThrow(/payload budget/u);
    const repository = createInMemoryAnalysisRepository();
    await expect(repository.save("owner", record)).rejects.toThrow(/payload budget/u);
    expect(await repository.findById("owner", record.id)).toBeNull();
  });
});
