interface CompatibleHttpErrorDefinition {
  readonly code: CompatibleHttpProviderErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export type CompatibleHttpProviderErrorCode =
  | "MODEL_PROVIDER_AUTH_FAILED"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "INVALID_RESPONSE"
  | "CANCELLED"
  | "INTERNAL_ERROR";

export type CompatibleHttpFetchAbortSource = "none" | "timeout" | "user";

const DEFINITIONS = {
  CANCELLED: { code: "CANCELLED", message: "Compatible HTTP request failed.", retryable: false },
  INTERNAL_ERROR: {
    code: "INTERNAL_ERROR",
    message: "Compatible HTTP request failed.",
    retryable: true,
  },
  INVALID_RESPONSE: {
    code: "INVALID_RESPONSE",
    message: "Compatible HTTP response was invalid.",
    retryable: true,
  },
  MODEL_PROVIDER_AUTH_FAILED: {
    code: "MODEL_PROVIDER_AUTH_FAILED",
    message: "Compatible HTTP authorization failed.",
    retryable: true,
  },
  NETWORK_ERROR: {
    code: "NETWORK_ERROR",
    message: "Compatible HTTP network request failed.",
    retryable: true,
  },
  RATE_LIMITED: {
    code: "RATE_LIMITED",
    message: "Compatible HTTP request was rate limited.",
    retryable: false,
  },
  TIMEOUT: { code: "TIMEOUT", message: "Compatible HTTP request timed out.", retryable: true },
} as const satisfies Record<CompatibleHttpProviderErrorCode, CompatibleHttpErrorDefinition>;

export class CompatibleHttpProviderError extends Error {
  readonly code: CompatibleHttpProviderErrorCode;
  readonly retryable: boolean;

  constructor(definition: CompatibleHttpErrorDefinition) {
    super(definition.message);
    this.name = "CompatibleHttpProviderError";
    this.code = definition.code;
    this.retryable = definition.retryable;
  }
}

export function compatibleHttpProviderError(
  code: CompatibleHttpProviderErrorCode,
  cause?: unknown,
): CompatibleHttpProviderError {
  void cause;
  return new CompatibleHttpProviderError(DEFINITIONS[code]);
}

export function compatibleHttpHttpError(status: number): CompatibleHttpProviderError {
  if (status === 401) return compatibleHttpProviderError("MODEL_PROVIDER_AUTH_FAILED");
  if (status === 403 || status === 429) return compatibleHttpProviderError("RATE_LIMITED");
  if (status === 502 || status === 503 || status === 504) {
    return compatibleHttpProviderError("NETWORK_ERROR");
  }
  return compatibleHttpProviderError("INVALID_RESPONSE");
}

function diagnostic(error: unknown, depth = 0): string {
  if (!(error instanceof Error) || depth > 1) return "";
  return `${error.message} ${diagnostic(error.cause, depth + 1)}`.slice(0, 1_024);
}

export function compatibleHttpFetchError(
  error: unknown,
  abortSource: CompatibleHttpFetchAbortSource,
): CompatibleHttpProviderError {
  if (abortSource === "user") return compatibleHttpProviderError("CANCELLED");
  if (abortSource === "timeout") return compatibleHttpProviderError("TIMEOUT");
  if (/unexpected redirect/i.test(diagnostic(error))) {
    return compatibleHttpProviderError("INVALID_RESPONSE");
  }
  if (error instanceof TypeError) return compatibleHttpProviderError("NETWORK_ERROR");
  return compatibleHttpProviderError("INTERNAL_ERROR");
}
