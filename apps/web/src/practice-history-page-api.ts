import type {
  DeletePracticeSessionRequest,
  ListPracticeSessionsQuery,
  PracticeHistoryDetailResponse,
  PracticeHistoryListResponse,
} from "@huayi/cloud-contracts";
import type { WebPracticeTeaching } from "./practice-teaching-api.js";

export interface PracticeHistoryPageApi {
  teaching?: WebPracticeTeaching;
  deletePracticeHistory(
    sessionId: string,
    input: DeletePracticeSessionRequest,
    key: string,
  ): Promise<{ deleted: true; id: string }>;
  getPracticeHistory(sessionId: string): Promise<PracticeHistoryDetailResponse>;
  listPracticeHistory(input: ListPracticeSessionsQuery): Promise<PracticeHistoryListResponse>;
}
