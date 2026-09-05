import {
  dailyPracticeQueueResponseSchema,
  practiceHistoryDetailResponseSchema,
  practiceHistoryListResponseSchema,
  practiceSessionResponseSchema,
} from "@huayi/cloud-contracts";

// Previous Web clients strictly reject fields introduced by PracticeWorkspace.
// Project only the HTTP response; preserve the authoritative session and draft.
function sessionV1(value: unknown) {
  const session = { ...practiceSessionResponseSchema.parse(value) };
  delete session.workspace;
  return session;
}

export const practiceResponsesV1 = {
  session: { parse: sessionV1 },
  dailyQueue: {
    parse(value: unknown) {
      const queue = dailyPracticeQueueResponseSchema.parse(value);
      const response = {
        ...queue,
        currentSession: queue.currentSession === null ? null : sessionV1(queue.currentSession),
      };
      delete response.completedToday;
      return response;
    },
  },
  historyList: {
    parse(value: unknown) {
      const history = practiceHistoryListResponseSchema.parse(value);
      return {
        ...history,
        items: history.items.map((item) => {
          const summary = { ...item };
          delete summary.workspacePhase;
          return summary;
        }),
      };
    },
  },
  historyDetail: {
    parse(value: unknown) {
      const detail = practiceHistoryDetailResponseSchema.parse(value);
      return { ...detail, session: sessionV1(detail.session) };
    },
  },
};
