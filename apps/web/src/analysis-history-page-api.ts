import type { AnalysisRecord, ListAnalysesQuery } from "@huayi/cloud-contracts";

export interface AnalysisHistoryPageApi {
  archiveAnalysis(id: string, revision: number, key: string): Promise<AnalysisRecord>;
  deleteAnalysis(
    id: string,
    revision: number,
    key: string,
    deleteStudyCapture: boolean,
  ): Promise<{ deleted: true; id: string }>;
  getAnalysis(id: string): Promise<AnalysisRecord>;
  listHistory(
    query: ListAnalysesQuery,
  ): Promise<{ items: AnalysisRecord[]; nextCursor: string | null }>;
  processNothingToSave(id: string, revision: number, key: string): Promise<AnalysisRecord>;
  restoreAnalysis(id: string, revision: number, key: string): Promise<AnalysisRecord>;
}
