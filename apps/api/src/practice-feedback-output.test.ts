import { describe, expect, it, vi } from "vitest";
import { formatPracticeTeachingFeedback } from "@huayi/cloud-contracts";
import {
  createPaidPracticeGenerator,
  practiceGenerationOutputSchema,
  type PracticeGenerationRepository,
} from "./paid-practice-generator.js";

const teachingFeedback = {
  assessment: "ready" as const,
  mainPointZh: "表达准确自然。",
  exampleSentence: "I need at least two days.",
  usageNoteZh: "至少说明一个数量下限。",
};
const output = {
  kind: "sentence-feedback" as const,
  teachingFeedback,
  feedback: formatPracticeTeachingFeedback(teachingFeedback),
};
const command = {
  generationId: "generation-1",
  leaseToken: "lease-1",
  ownerUserId: "owner-1",
  kind: "sentence-feedback" as const,
  input: {
    answer: "I need at least two days.",
    prompt: "说明最短所需时间。",
    teachingContract: "practice-teaching-v1",
    itemContent: { type: "expression", text: "at least", meaningZh: "至少", usageZh: "数量下限。" },
  },
};
function fixture(value: unknown) {
  const repository: PracticeGenerationRepository = {
    acquire: vi.fn(async () => ({ kind: "acquired" as const, reservationId: "reservation-1" })),
    markDispatched: vi.fn(async () => true),
    complete: vi.fn(async ({ output: saved }) => saved),
    fail: vi.fn(async () => undefined),
  };
  const provider = {
    generate: vi.fn(async () => ({
      output: value,
      billedCalls: [
        { costMicroUsd: 1, usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 } },
      ],
    })),
  };
  return { repository, generator: createPaidPracticeGenerator({ repository, provider }) };
}
describe("pinned sentence teaching feedback", () => {
  it("keeps the full teaching output while projecting the bounded legacy string", async () => {
    expect(practiceGenerationOutputSchema.parse(output)).toEqual(output);
    const { generator } = fixture(output);
    await expect(generator.generate(command)).resolves.toEqual(output);
  });
  it("does not silently accept legacy-only feedback for a teaching generation", async () => {
    const { generator, repository } = fixture({ kind: "sentence-feedback", feedback: "准确。" });
    await expect(generator.generate(command)).resolves.toBeNull();
    expect(repository.fail).toHaveBeenCalledWith(
      expect.objectContaining({ stableErrorCode: "model_output_invalid" }),
    );
  });
  it.each([
    { ...output, feedback: "a different projection" },
    { ...output, teachingFeedback: { ...teachingFeedback, answerExcerpt: "invented error" } },
    { ...output, teachingFeedback: { ...teachingFeedback, usageNoteZh: "中".repeat(1001) } },
  ])("rejects inconsistent, invented or oversized structure", (invalid) => {
    expect(practiceGenerationOutputSchema.safeParse(invalid).success).toBe(false);
  });
  it("requires the issue excerpt to come from the exact submitted answer", async () => {
    const feedback = {
      ...teachingFeedback,
      assessment: "needs-revision" as const,
      answerExcerpt: "He go",
    };
    const { generator, repository } = fixture({
      kind: "sentence-feedback",
      teachingFeedback: feedback,
      feedback: formatPracticeTeachingFeedback(feedback),
    });
    await expect(generator.generate(command)).resolves.toBeNull();
    expect(repository.fail).toHaveBeenCalledWith(
      expect.objectContaining({ stableErrorCode: "model_output_invalid" }),
    );
  });
  it("accepts an actual revision and keeps the original legacy contract separate", async () => {
    const feedback = {
      ...teachingFeedback,
      assessment: "needs-revision" as const,
      answerExcerpt: "I need",
    };
    const corrected = {
      kind: "sentence-feedback" as const,
      teachingFeedback: feedback,
      feedback: formatPracticeTeachingFeedback(feedback),
    };
    await expect(fixture(corrected).generator.generate(command)).resolves.toEqual(corrected);
    const legacy = {
      ...command,
      input: {
        answer: command.input.answer,
        itemContent: command.input.itemContent,
        prompt: command.input.prompt,
      },
    };
    await expect(fixture(output).generator.generate(legacy)).resolves.toBeNull();
    await expect(
      fixture({ kind: "sentence-feedback", feedback: "准确。" }).generator.generate(legacy),
    ).resolves.toEqual({ kind: "sentence-feedback", feedback: "准确。" });
  });
});
