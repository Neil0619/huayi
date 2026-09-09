import {
  canonicalKeyForContent,
  type AnalysisRecord,
  type ConfirmCandidatesRequest,
  type LearningItemDetailResponse,
} from "@huayi/cloud-contracts";
export function candidateDecisions(
  record: AnalysisRecord,
  chosen: string[],
  library: LearningItemDetailResponse[],
): ConfirmCandidatesRequest["confirmations"] {
  return record.candidates
    .filter((candidate) => chosen.includes(candidate.id))
    .map((candidate) => {
      const key = canonicalKeyForContent(candidate.payload);
      const existing = library.find(
        (detail) => detail.item.type === candidate.type && detail.item.canonicalKey === key,
      );
      const common = {
        candidateId: candidate.id,
        decision: existing ? `merge:${existing.item.id}` : "create",
        tags: [],
        systemAttributes: [],
      };
      return candidate.type === "expression"
        ? { ...common, targetType: "expression", payload: candidate.payload }
        : { ...common, targetType: "sentence-pattern", payload: candidate.payload };
    });
}
