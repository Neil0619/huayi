import { analysisSseEnvelopeSchema } from "./analysis-contracts.js";
import { createAnalysisEventSseDecoder } from "./analysis-sse-decoder.js";
import { analysisEventReadSchema } from "./structured-teaching-events.js";

const readEnvelope = analysisSseEnvelopeSchema.extend({ data: analysisEventReadSchema });
/** Native readers accept the new structures and frozen legacy records through one bounded framer. */
export function createStructuredAnalysisSseDecoder() {
  return createAnalysisEventSseDecoder((value) => readEnvelope.parse(value).data);
}
