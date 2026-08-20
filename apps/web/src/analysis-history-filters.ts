import type { ListAnalysesQuery } from "@huayi/cloud-contracts";

export interface AnalysisHistoryFilters {
  archived: boolean;
  query: string;
  reviewState: "" | "pendingReview" | "reviewed";
  selectionKind: "" | "phrase" | "sentence" | "passage";
  sourceType: "" | "manual" | "study-capture";
}

export const initialAnalysisHistoryFilters: AnalysisHistoryFilters = {
  archived: false,
  query: "",
  reviewState: "",
  selectionKind: "",
  sourceType: "",
};

export function toAnalysisHistoryQuery(
  filters: AnalysisHistoryFilters,
  cursor?: string,
): ListAnalysesQuery {
  return {
    archived: filters.archived,
    limit: 20,
    ...(cursor === undefined ? {} : { cursor }),
    ...(filters.query === "" ? {} : { query: filters.query }),
    ...(filters.reviewState === "" ? {} : { reviewState: filters.reviewState }),
    ...(filters.selectionKind === "" ? {} : { selectionKind: filters.selectionKind }),
    ...(filters.sourceType === "" ? {} : { sourceType: filters.sourceType }),
  };
}
