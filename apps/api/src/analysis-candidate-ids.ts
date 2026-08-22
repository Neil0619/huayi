import { analysisContentSchema, type AnalysisContent } from "@huayi/cloud-contracts";

export function replaceCandidateAliases(
  content: AnalysisContent,
  ids: () => string,
): AnalysisContent {
  const candidateIds = new Map(
    content.candidates.map((candidate) => [candidate.id, ids()] as const),
  );
  const resolveCandidateId = (candidateId: string) => {
    const resolved = candidateIds.get(candidateId);
    if (resolved === undefined) throw new Error("Candidate alias is unavailable.");
    return resolved;
  };
  const result =
    content.result.type === "phrase-analysis-v2"
      ? {
          ...content.result,
          candidateIds: content.result.candidateIds.map(resolveCandidateId),
        }
      : {
          ...content.result,
          sentences: content.result.sentences.map((sentence) => ({
            ...sentence,
            candidateIds: sentence.candidateIds.map(resolveCandidateId),
          })),
        };
  return analysisContentSchema.parse({
    ...content,
    candidates: content.candidates.map((candidate) => ({
      ...candidate,
      id: resolveCandidateId(candidate.id),
    })),
    result,
  });
}
