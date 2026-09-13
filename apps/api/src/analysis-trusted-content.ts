import {
  analysisContentSchema,
  structuredAnalysisContentSchema,
  normalizeWhitespaceAndQuotes,
  type AnalysisContentRead,
  type AnalysisRecordRead,
  type StartAnalysisGenerationRequest,
} from "@huayi/cloud-contracts";
import { createHash } from "node:crypto";

import type { SegmentedSentence } from "./analysis-ports.js";

export function createAnalysisRecord(
  content: AnalysisContentRead,
  id: string,
  now: string,
): AnalysisRecordRead {
  return {
    ...content,
    archivedAt: null,
    createdAt: now,
    id,
    reviewState: "pendingReview",
    revision: 1,
    updatedAt: now,
  };
}

interface TrustedCaptureContext {
  captureId: string;
  source: AnalysisContentRead["source"];
}

export function assembleTrustedContent(
  generated: unknown,
  input: StartAnalysisGenerationRequest,
  sentences: readonly SegmentedSentence[],
  capture?: TrustedCaptureContext,
): AnalysisContentRead {
  const schema =
    "outputContract" in input ? structuredAnalysisContentSchema : analysisContentSchema;
  if (typeof generated !== "object" || generated === null) return schema.parse(generated);
  const raw = generated as Record<string, unknown>;
  let result = raw.result;
  if (typeof result === "object" && result !== null && "sentences" in result) {
    const passage = result as Record<string, unknown>;
    if (!Array.isArray(passage.sentences) || passage.sentences.length !== sentences.length) {
      return schema.parse({});
    }
    result = {
      ...passage,
      sentences: passage.sentences.map((value, index) => ({
        ...(typeof value === "object" && value !== null ? value : {}),
        ...sentences[index],
      })),
    };
  }
  return schema.parse({
    candidates: raw.candidates,
    modelMetadata: raw.modelMetadata,
    result,
    selectionKind: input.selectionKind,
    source: capture?.source ?? input.source,
    sourceNormalizedHash: createHash("sha256")
      .update(normalizeWhitespaceAndQuotes(input.sourceText))
      .digest("hex"),
    sourceText: input.sourceText,
    ...(capture === undefined ? {} : { studyCaptureId: capture.captureId }),
  });
}
