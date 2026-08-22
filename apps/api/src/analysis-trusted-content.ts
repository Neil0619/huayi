import {
  analysisContentSchema,
  normalizeWhitespaceAndQuotes,
  type AnalysisContent,
  type StartAnalysisRequest,
} from "@huayi/cloud-contracts";
import { createHash } from "node:crypto";

import type { SegmentedSentence } from "./analysis-ports.js";

interface TrustedCaptureContext {
  captureId: string;
  source: AnalysisContent["source"];
}

export function assembleTrustedContent(
  generated: unknown,
  input: StartAnalysisRequest,
  sentences: readonly SegmentedSentence[],
  capture?: TrustedCaptureContext,
): AnalysisContent {
  if (typeof generated !== "object" || generated === null)
    return analysisContentSchema.parse(generated);
  const raw = generated as Record<string, unknown>;
  let result = raw.result;
  if (typeof result === "object" && result !== null && "sentences" in result) {
    const passage = result as Record<string, unknown>;
    if (!Array.isArray(passage.sentences) || passage.sentences.length !== sentences.length) {
      return analysisContentSchema.parse({});
    }
    result = {
      ...passage,
      sentences: passage.sentences.map((value, index) => ({
        ...(typeof value === "object" && value !== null ? value : {}),
        ...sentences[index],
      })),
    };
  }
  return analysisContentSchema.parse({
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
