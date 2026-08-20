import type {
  DeletePracticeSessionRequest,
  ListPracticeSessionsQuery,
  PracticeHistoryDetailResponse,
  PracticeHistoryListResponse,
} from "@huayi/cloud-contracts";

export interface PracticeHistoryPageApi {
  deletePracticeHistory(
    sessionId: string,
    input: DeletePracticeSessionRequest,
    key: string,
  ): Promise<{ deleted: true; id: string }>;
  getPracticeHistory(sessionId: string): Promise<PracticeHistoryDetailResponse>;
  listPracticeHistory(input: ListPracticeSessionsQuery): Promise<PracticeHistoryListResponse>;
}
