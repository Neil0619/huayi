export type BrowserAnalysisErrorCode =
  | "cancelled"
  | "credential-missing"
  | "invalid-response"
  | "network-error"
  | "provider-error"
  | "timeout"
  | "internal-error";

const PUBLIC_MESSAGES: Readonly<Record<BrowserAnalysisErrorCode, string>> = {
  cancelled: "Analysis was cancelled.",
  "credential-missing": "The selected provider is not configured.",
  "invalid-response": "The provider returned an invalid response.",
  "network-error": "The provider request failed.",
  "provider-error": "The provider rejected the request.",
  timeout: "The provider request timed out.",
  "internal-error": "Local encrypted storage is unavailable.",
};

export class BrowserAnalysisError extends Error {
  readonly code: BrowserAnalysisErrorCode;

  constructor(code: BrowserAnalysisErrorCode) {
    super(PUBLIC_MESSAGES[code]);
    this.name = "BrowserAnalysisError";
    this.code = code;
  }
}

export function invalidResponse(): never {
  throw new BrowserAnalysisError("invalid-response");
}
