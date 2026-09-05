import type { LearningTaskClient } from "@huayi/cloud-contracts";
import type { WebPracticeWorkspace } from "./practice-workspace-api.js";
import type {
  DailyPracticeQueueResponse,
  LearningItemDetailResponse,
  PracticeSession,
} from "@huayi/cloud-contracts";

export interface PracticePageApi {
  tasks?: LearningTaskClient;
  workspace?: WebPracticeWorkspace;
  dailyQueue(): Promise<DailyPracticeQueueResponse>;
  finish(
    sessionId: string,
    input: { expectedRevision: number },
    key: string,
  ): Promise<PracticeSession>;
  getLearningItem(id: string): Promise<LearningItemDetailResponse>;
  rate(
    sessionId: string,
    input: {
      expectedRevision: number;
      ratings: { itemId: string; rating: "effortful" | "forgot" | "mastered" }[];
    },
    key: string,
  ): Promise<PracticeSession>;
  retryAssistant(
    sessionId: string,
    input: { expectedRevision: number },
    key: string,
  ): Promise<PracticeSession>;
  retryFeedback(
    sessionId: string,
    attemptId: string,
    input: { expectedRevision: number },
    key: string,
  ): Promise<PracticeSession>;
  startDialogue(itemIds: string[], key: string): Promise<PracticeSession>;
  startSentence(itemId: string, key: string): Promise<PracticeSession>;
  submitAttempt(
    sessionId: string,
    input: { answer: string; expectedRevision: number },
    key: string,
  ): Promise<PracticeSession>;
  submitTurn(
    sessionId: string,
    input: { content: string; expectedRevision: number },
    key: string,
  ): Promise<PracticeSession>;
}
