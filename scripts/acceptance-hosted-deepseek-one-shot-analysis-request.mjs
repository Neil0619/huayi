import { createHash } from "node:crypto";

export const hostedDeepSeekAnalysisRequestBody = Object.freeze({
  selectionKind: "sentence",
  source: Object.freeze({ type: "manual" }),
  sourceText: "The team checked every detail before it made one careful decision.",
});

export const hostedDeepSeekPayloadDigest = createHash("sha256")
  .update(JSON.stringify(hostedDeepSeekAnalysisRequestBody))
  .digest("hex");
