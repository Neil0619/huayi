import { analysisRecordSchema, contractFixtures } from "@huayi/cloud-contracts";
import { describe, expect, it } from "vitest";

import { createAnalysisHistoryModule } from "./analysis-history-module.js";
import { createInMemoryAnalysisRepository } from "./analysis-repository.js";
import { MutableClock } from "./test-support/security-fakes.js";

describe("analysis history module", () => {
  it("paginates stable ties, filters all fields, and rejects cursor tampering", async () => {
    const repository = createInMemoryAnalysisRepository();
    const module = createAnalysisHistoryModule({
      clock: new MutableClock("2026-08-13T00:00:00.000Z"),
      cursorKey: new Uint8Array(32).fill(3),
      repository,
    });
    for (const [id, sourceText, sourceType, selectionKind] of [
      ["analysis-c", "Find 100% value_ now.", "manual", "passage"],
      ["analysis-b", "Find 100x valueA now.", "manual", "passage"],
      ["analysis-a", "Archived 100% value_ now.", "study-capture", "sentence"],
    ] as const) {
      await repository.save(
        "user-a",
        analysisRecordSchema.parse({
          ...contractFixtures.analysis,
          archivedAt: id === "analysis-a" ? "2026-08-12T11:00:00.000Z" : null,
          id,
          selectionKind,
          source: { type: sourceType },
          sourceText,
        }),
      );
    }
    const first = await module.listAnalyses("user-a", {
      archived: false,
      limit: 1,
      query: "100% value_",
      reviewState: "pendingReview",
      selectionKind: "passage",
      sourceType: "manual",
    });
    expect(first.items.map((item) => item.id)).toEqual(["analysis-c"]);
    expect(first.nextCursor).toBeNull();
    const page = await module.listAnalyses("user-a", { archived: false, limit: 1 });
    expect(page.items[0]?.id).toBe("analysis-c");
    expect(page.nextCursor).not.toBeNull();
    const second = await module.listAnalyses("user-a", {
      archived: false,
      cursor: page.nextCursor ?? "missing",
      limit: 1,
    });
    expect(second.items[0]?.id).toBe("analysis-b");
    await expect(
      module.listAnalyses("user-a", { archived: false, cursor: "dGFtcGVyZWQ", limit: 1 }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("replays mutations and rejects changed payload or stale revisions without side effects", async () => {
    const repository = createInMemoryAnalysisRepository();
    const clock = new MutableClock("2026-08-13T00:00:00.000Z");
    const module = createAnalysisHistoryModule({
      clock,
      cursorKey: new Uint8Array(32).fill(4),
      repository,
    });
    await repository.save("user-a", analysisRecordSchema.parse(contractFixtures.analysis));
    const command = {
      expectedRevision: 1,
      id: contractFixtures.analysis.id,
      idempotencyKey: "process-1",
      userId: "user-a",
    };
    const processed = await module.processNothingToSave(command);
    expect(processed).toMatchObject({ reviewState: "reviewed", revision: 2 });
    expect(await module.processNothingToSave(command)).toEqual(processed);
    await expect(
      module.processNothingToSave({ ...command, expectedRevision: 2 }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(
      module.archiveAnalysis({ ...command, idempotencyKey: "archive-stale" }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    expect(await module.getAnalysis("user-a", command.id)).toEqual(processed);
  });
});
