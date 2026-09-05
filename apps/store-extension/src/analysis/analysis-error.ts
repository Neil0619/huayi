export type BrowserAnalysisErrorCode =
  | "cancelled"
  | "cloud-access-denied"
  | "cloud-session-required"
  | "credential-missing"
  | "invalid-response"
  | "network-error"
  | "provider-error"
  | "quota-exhausted"
  | "timeout"
  | "version-mismatch"
  | "internal-error";

const PUBLIC_MESSAGES: Readonly<Record<BrowserAnalysisErrorCode, string>> = {
  cancelled: "Analysis was cancelled.",
  "cloud-access-denied": "The account service denied extension access.",
  "cloud-session-required": "The account connection is no longer available.",
  "credential-missing": "The selected provider is not configured.",
  "invalid-response": "The provider returned an invalid response.",
  "network-error": "The provider request failed.",
  "provider-error": "The provider rejected the request.",
  "quota-exhausted": "The platform usage allowance is exhausted.",
  timeout: "The provider request timed out.",
  "version-mismatch": "The extension must be updated.",
  "internal-error": "Local encrypted storage is unavailable.",
};

export class BrowserAnalysisError extends Error {
  readonly code: BrowserAnalysisErrorCode;

  constructor(
    code: BrowserAnalysisErrorCode,
    readonly diagnosticId?: string,
  ) {
    super(PUBLIC_MESSAGES[code]);
    this.name = "BrowserAnalysisError";
    this.code = code;
  }
}

export function invalidResponse(): never {
  throw new BrowserAnalysisError("invalid-response");
}
