import {
  analysisRecordSchema,
  confirmCandidatesRequestSchema,
  confirmCandidatesResponseSchema,
  contractFixtures,
} from "@huayi/cloud-contracts";
import { describe, expect, it } from "vitest";

import { createCandidateConfirmationModule } from "./candidate-confirmation-module.js";
import { createInMemoryAnalysisRepository } from "./analysis-repository.js";
import { MutableClock } from "./test-support/security-fakes.js";

function fixture() {
  const repository = createInMemoryAnalysisRepository();
  let sequence = 0;
  const module = createCandidateConfirmationModule({
    clock: new MutableClock("2026-08-12T10:00:00.000Z"),
    ids: () => `generated-${++sequence}`,
    repository,
  });
  return { module, repository };
}

const confirmationRequest = () =>
  confirmCandidatesRequestSchema.parse(contractFixtures.confirmCandidatesRequest);
const expressionConfirmation = () => {
  const confirmation = confirmationRequest().confirmations[0];
  if (confirmation?.targetType !== "expression") throw new Error("Missing expression fixture.");
  return confirmation;
};

describe("candidate confirmation module", () => {
  it("uses edited content and trusted sentence source, then replays the full response", async () => {
    const { module, repository } = fixture();
    await repository.save("user-a", analysisRecordSchema.parse(contractFixtures.analysis));
    const command = {
      analysisId: "analysis-1",
      idempotencyKey: "confirm-1",
      input: {
        ...confirmationRequest(),
        confirmations: [
          {
            ...expressionConfirmation(),
            payload: {
              ...expressionConfirmation().payload,
              meaningZh: "直说吧",
            },
          },
        ],
      },
      userId: "user-a",
    };
    const response = await module.confirmCandidates(command);
    expect(confirmCandidatesResponseSchema.parse(response)).toMatchObject({
      analysis: { reviewState: "reviewed", revision: 2 },
      results: [
        {
          action: "created",
          item: {
            content: { meaningZh: "直说吧" },
            sourceExamples: [
              {
                sourceText: "To be frank, this works.",
                translationZh: "坦率地说，这很有效。",
              },
            ],
          },
          type: "learning-item",
        },
      ],
    });
    await expect(module.confirmCandidates(command)).resolves.toEqual(response);
    await expect(
      module.confirmCandidates({ ...command, analysisId: "analysis-other" }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
    await repository.delete({
      expectedRevision: 2,
      id: "analysis-1",
      idempotencyKey: "delete-after-confirm",
      requestHash: "delete-after-confirm-hash",
      updatedAt: "2026-08-12T10:01:00.000Z",
      userId: "user-a",
    });
    await expect(module.confirmCandidates(command)).resolves.toEqual(response);
    await expect(
      module.confirmCandidates({
        ...command,
        input: { ...command.input, analysisRevision: 2 },
      }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("rejects wrong routing and cross-tenant candidates without side effects", async () => {
    const { module, repository } = fixture();
    await repository.save("user-a", analysisRecordSchema.parse(contractFixtures.analysis));
    await expect(
      module.confirmCandidates({
        analysisId: "analysis-1",
        idempotencyKey: "bad-route",
        input: {
          analysisRevision: 1,
          confirmations: [
            {
              candidateId: "candidate-1",
              decision: "create",
              payload: {
                functionZh: "错误路由",
                slots: [{ descriptionZh: "观点", name: "opinion" }],
                template: "To be frank, {opinion}",
                type: "sentence_pattern",
                usageZh: "错误目标类型不应通过。",
              },
              systemAttributes: [],
              tags: [],
              targetType: "sentence-pattern",
            },
          ],
        },
        userId: "user-a",
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      module.confirmCandidates({
        analysisId: "analysis-1",
        idempotencyKey: "other-user",
        input: confirmationRequest(),
        userId: "user-b",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(repository.findById("user-a", "analysis-1")).resolves.toMatchObject({
      reviewState: "pendingReview",
      revision: 1,
    });
  });

  it("rejects an exact duplicate create for one owner but not another owner", async () => {
    const { module, repository } = fixture();
    const first = analysisRecordSchema.parse(contractFixtures.analysis);
    await repository.save("user-a", first);
    await repository.save("user-b", { ...first, id: "analysis-b" });
    await module.confirmCandidates({
      analysisId: first.id,
      idempotencyKey: "owner-a-first",
      input: confirmationRequest(),
      userId: "user-a",
    });
    await expect(
      module.confirmCandidates({
        analysisId: "analysis-b",
        idempotencyKey: "owner-b-first",
        input: confirmationRequest(),
        userId: "user-b",
      }),
    ).resolves.toMatchObject({ results: [{ action: "created" }] });
    await repository.save("user-a", { ...first, id: "analysis-a-second" });
    await expect(
      module.confirmCandidates({
        analysisId: "analysis-a-second",
        idempotencyKey: "owner-a-duplicate",
        input: confirmationRequest(),
        userId: "user-a",
      }),
    ).rejects.toMatchObject({ code: "exact_duplicate" });
    await expect(repository.findById("user-a", "analysis-a-second")).resolves.toMatchObject({
      reviewState: "pendingReview",
      revision: 1,
    });
  });
});
