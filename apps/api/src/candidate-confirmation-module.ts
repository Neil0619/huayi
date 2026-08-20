import {
  canonicalKeyForContent,
  confirmCandidatesRequestSchema,
  normalizeTagName,
  type ConfirmCandidatesRequest,
  type AnalysisRecord,
} from "@huayi/cloud-contracts";
import { createHash } from "node:crypto";

import { CloudFault } from "./cloud-fault.js";
import type { AnalysisRepository, PreparedCandidateConfirmation } from "./analysis-ports.js";
import type { Clock } from "./security.js";

export function createCandidateConfirmationModule(dependencies: {
  clock: Clock;
  ids: () => string;
  repository: AnalysisRepository;
}) {
  return {
    async confirmCandidates(command: {
      analysisId: string;
      idempotencyKey: string;
      input: ConfirmCandidatesRequest;
      userId: string;
    }) {
      const input = confirmCandidatesRequestSchema.parse(command.input);
      const requestHash = createHash("sha256")
        .update(JSON.stringify({ analysisId: command.analysisId, input }))
        .digest("hex");
      const replay = await dependencies.repository.replayCandidateConfirmation({
        idempotencyKey: command.idempotencyKey,
        requestHash,
        userId: command.userId,
      });
      if (replay !== null) return replay;
      const analysis = await dependencies.repository.findById(command.userId, command.analysisId);
      if (analysis === null) {
        const concurrentReplay = await dependencies.repository.replayCandidateConfirmation({
          idempotencyKey: command.idempotencyKey,
          requestHash,
          userId: command.userId,
        });
        if (concurrentReplay !== null) return concurrentReplay;
        throw new CloudFault("not_found", "Analysis not found.");
      }
      const candidates = new Map(analysis.candidates.map((candidate) => [candidate.id, candidate]));
      const entries: PreparedCandidateConfirmation[] = input.confirmations.map((confirmation) => {
        const candidate = candidates.get(confirmation.candidateId);
        if (candidate === undefined) {
          throw new CloudFault(
            "invalid_request",
            "A selected candidate does not belong to the analysis.",
          );
        }
        if (candidate.type !== confirmation.targetType) {
          throw new CloudFault(
            "invalid_request",
            "A candidate cannot be routed to that target type.",
          );
        }
        const action = confirmation.decision === "create" ? "created" : "merged";
        const targetId =
          action === "created" ? dependencies.ids() : confirmation.decision.slice("merge:".length);
        const source = sourceSnapshot(analysis, candidate.analysisUnitId);
        return {
          action,
          canonicalKey: canonicalKeyForContent(confirmation.payload),
          candidateId: candidate.id,
          content: confirmation.payload,
          source,
          sourceExampleId: dependencies.ids(),
          systemAttributes: [...confirmation.systemAttributes],
          tags: confirmation.tags.map((displayName) => ({
            displayName,
            id: dependencies.ids(),
            normalizedName: normalizeTagName(displayName),
          })),
          targetId,
          type: confirmation.targetType,
        };
      });
      return dependencies.repository.confirmCandidates({
        analysisId: command.analysisId,
        entries,
        expectedRevision: input.analysisRevision,
        idempotencyKey: command.idempotencyKey,
        requestHash,
        updatedAt: dependencies.clock.now().toISOString(),
        userId: command.userId,
      });
    },
  };
}

function sourceSnapshot(analysis: AnalysisRecord, analysisUnitId: string) {
  let sourceText = analysis.sourceText;
  let translationZh: string | undefined;
  if ("sentences" in analysis.result && Array.isArray(analysis.result.sentences)) {
    const sentence = analysis.result.sentences.find(
      (value) => value.analysisUnitId === analysisUnitId,
    );
    if (sentence !== undefined) {
      sourceText = sentence.sourceText;
      translationZh = sentence.translationZh;
    }
  }
  return {
    analysisId: analysis.id,
    analysisUnitId,
    sourceText,
    ...(analysis.source.title === undefined ? {} : { sourceTitle: analysis.source.title }),
    sourceType: analysis.source.type,
    ...(translationZh === undefined ? {} : { translationZh }),
  };
}
