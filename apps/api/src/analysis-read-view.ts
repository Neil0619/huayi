import {
  acceptsStructuredTeaching,
  analysisEventReadSchema,
  analysisHistoryReadResponseSchema,
  analysisRecordReadSchema,
  confirmCandidatesReadResponseSchema,
  projectAnalysisEventForLegacy,
  projectAnalysisRecordForLegacy,
  type AnalysisEventRead,
  type AnalysisRecordRead,
  type ConfirmCandidatesReadResponse,
} from "@huayi/cloud-contracts";
import { CloudFault } from "./cloud-fault.js";
export { privateNegotiatedResponse as analysisReadResponseHeaders } from "./private-negotiated-response.js";

/** Representation belongs to the current reader, never to a saved idempotent response. */
export function createAnalysisReadView(accept: string | undefined) {
  const nativeJson = acceptsStructuredTeaching(accept, "json");
  const nativeSse = acceptsStructuredTeaching(accept, "eventStream");
  const record = (value: AnalysisRecordRead) =>
    nativeJson ? analysisRecordReadSchema.parse(value) : projectAnalysisRecordForLegacy(value);
  return {
    record,
    history(value: unknown) {
      const page = analysisHistoryReadResponseSchema.parse(value);
      return { ...page, items: page.items.map(record) };
    },
    confirmation(value: ConfirmCandidatesReadResponse) {
      const response = confirmCandidatesReadResponseSchema.parse(value);
      return { ...response, analysis: record(response.analysis) };
    },
    sse(value: AnalysisEventRead, id: number) {
      const event = nativeSse
        ? analysisEventReadSchema.parse(value)
        : projectAnalysisEventForLegacy(value);
      const data = JSON.stringify(event);
      // JSON stringification escapes CR/LF; Hono emits these three single-line fields.
      const frame = `event: analysis\ndata: ${data}\nid: ${id}\n\n`;
      if (frame.length > 64 * 1024)
        throw new CloudFault("model_output_invalid", "The analysis event exceeds its limit.");
      return { data, event: "analysis", id: String(id) };
    },
  };
}
