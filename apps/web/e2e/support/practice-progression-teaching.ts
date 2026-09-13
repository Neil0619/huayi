import {
  formatPracticeTeachingFeedback,
  practiceTeachingDetailSchema,
  type PracticeSession,
  type PracticeTeachingDetail,
  type PracticeWorkspaceStart,
  type LearningItemContent,
} from "@huayi/cloud-contracts";

const feedback = {
  assessment: "ready" as const,
  mainPointZh: "意思表达清楚，目标表达使用自然。",
  exampleSentence: "At least we can finish tomorrow.",
  usageNoteZh: "适合说明仍然可以做到的事情。",
};
/** R5's navigation authority now honors the new client's explicit teaching capability. */
export function createProgressionTeaching() {
  const states = new Map<string, NonNullable<PracticeTeachingDetail["teaching"]>>();
  return {
    start(session: PracticeSession, input: PracticeWorkspaceStart, content: LearningItemContent) {
      if (!input.teachingContract) return;
      states.set(session.id, {
        contract: input.teachingContract,
        hintPolicy: input.hintPolicy ?? "shown",
        target: {
          state: "available",
          itemId: input.itemId,
          content,
          capturedAt: session.createdAt,
        },
        round: { ordinal: 0, parentAttemptId: null, hintViewedAt: null },
        attempts: [],
      });
    },
    feedback(session: PracticeSession) {
      return states.has(session.id)
        ? formatPracticeTeachingFeedback(feedback)
        : "意思表达清楚，目标表达使用自然。";
    },
    detail(session: PracticeSession) {
      const state = states.get(session.id);
      return practiceTeachingDetailSchema.parse({
        version: 1,
        session,
        teaching: state
          ? {
              ...state,
              attempts: (session.attempts ?? []).map((attempt, ordinal, attempts) => ({
                attemptId: attempt.id,
                ordinal,
                parentAttemptId: attempts[ordinal - 1]?.id ?? null,
                hintViewedAt: null,
                feedback: attempt.feedback ? feedback : null,
                feedbackCompletedAt: attempt.feedback ? session.updatedAt : null,
              })),
            }
          : null,
      });
    },
  };
}
