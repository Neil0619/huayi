import { z } from "zod";

import { MAX_ERROR_MESSAGE_LENGTH } from "./limits.js";

export const errorCodeSchema = z.enum([
  "HOST_NOT_INSTALLED",
  "CODEX_NOT_AUTHENTICATED",
  "CODEX_CAPABILITY_MISSING",
  "MODEL_PROVIDER_NOT_CONFIGURED",
  "MODEL_PROVIDER_AUTH_FAILED",
  "EUDIC_NOT_CONFIGURED",
  "EUDIC_AUTH_FAILED",
  "RATE_LIMITED",
  "QUOTA_EXCEEDED",
  "NETWORK_ERROR",
  "TIMEOUT",
  "INVALID_RESPONSE",
  "CANCELLED",
  "UNSUPPORTED_SELECTION",
  "INTERNAL_ERROR",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const analysisErrorSchema = z.strictObject({
  code: errorCodeSchema,
  message: z.string().trim().min(1).max(MAX_ERROR_MESSAGE_LENGTH),
  retryable: z.boolean(),
});
export type AnalysisError = z.infer<typeof analysisErrorSchema>;
