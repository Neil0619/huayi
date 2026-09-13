import {
  contractFixtures,
  formatPracticeTeachingFeedback,
  learningItemDetailResponseSchema,
  practiceTeachingDetailSchema,
  type PracticeTeachingDetail,
} from "@huayi/cloud-contracts";

export const practiceDate = "2026-09-13T00:00:00.000Z";
export const practiceTarget = learningItemDetailResponseSchema.parse({
  archivedAt: null,
  hasPracticeHistory: true,
  recentPractice: null,
  item: contractFixtures.confirmCandidatesResponse.results[0].item,
  schedule: { consecutiveMastered: 0, dueAt: null, level: -1 },
});
export function teachingFixture(completed = false): PracticeTeachingDetail {
  const feedback = {
    assessment: "ready" as const,
    mainPointZh: "表达已经清楚，可以直接使用。",
    exampleSentence: "To be frank, I prefer the first plan.",
    usageNoteZh: "适合坦率而礼貌地说明自己的想法。",
  };
  return practiceTeachingDetailSchema.parse({
    version: 1,
    session: {
      id: "teaching-session",
      type: "sentence-creation",
      status: completed ? "completed" : "active",
      revision: completed ? 3 : 2,
      createdAt: practiceDate,
      updatedAt: practiceDate,
      prompt: "和同事讨论方案时，坦率地表达你的想法。",
      items: [
        { itemId: practiceTarget.item.id, position: 0, scheduleBefore: practiceTarget.schedule },
      ],
      turns: [],
      attempts: completed
        ? [
            {
              id: "answer-original",
              answer: "To be frank, I prefer this plan.",
              itemIds: [practiceTarget.item.id],
              submittedAt: practiceDate,
              feedback: formatPracticeTeachingFeedback(feedback),
            },
          ]
        : [],
      ...(completed ? { finalFeedback: formatPracticeTeachingFeedback(feedback) } : {}),
      workspace: {
        mode: "guided",
        phase: "active",
        controlRevision: 0,
        draftRevision: 0,
        draft: "",
      },
    },
    teaching: {
      contract: "practice-teaching-v1",
      hintPolicy: "on-demand",
      target: {
        state: "available",
        itemId: practiceTarget.item.id,
        capturedAt: practiceDate,
        content: practiceTarget.item.content,
      },
      round: { ordinal: 0, parentAttemptId: null, hintViewedAt: null },
      attempts: completed
        ? [
            {
              attemptId: "answer-original",
              ordinal: 0,
              parentAttemptId: null,
              hintViewedAt: null,
              feedback,
              feedbackCompletedAt: practiceDate,
            },
          ]
        : [],
    },
  });
}
