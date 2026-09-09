import { expect, it } from "vitest";
import {
  analysisRecordSchema,
  contractFixtures,
  learningItemDetailResponseSchema,
} from "@huayi/cloud-contracts";
import { candidateDecisions } from "./candidates";
it("uses the shared canonical identity to merge existing candidates, including archived items", () => {
  const record = analysisRecordSchema.parse(contractFixtures.analysis);
  const item = learningItemDetailResponseSchema.parse({
    item: contractFixtures.confirmCandidatesResponse.results[0].item,
    archivedAt: "2026-09-09T00:00:00Z",
    hasPracticeHistory: false,
    recentPractice: null,
    schedule: { level: -1, dueAt: null, consecutiveMastered: 0 },
  });
  expect(candidateDecisions(record, ["candidate-1"], [item])[0]?.decision).toBe(
    `merge:${item.item.id}`,
  );
  expect(candidateDecisions(record, ["candidate-1"], [])[0]?.decision).toBe("create");
});
