const safeDiagnosticStages = new Set([
  "configure-api",
  "configure-web",
  "create-api",
  "create-web",
  "credential",
  "input",
  "inspect-api",
  "inspect-web",
  "internal",
  "resolve-team",
  "verify-api",
  "verify-deployments-api",
  "verify-deployments-web",
  "verify-web",
]);
const safeDiagnosticReasons = new Set([
  "invalid-arguments",
  "preflight-rejected",
  "request-rejected",
  "response-invalid",
  "scope-mismatch",
  "token-unavailable",
  "transport-failed",
  "unexpected",
  "verification-failed",
]);

class VercelProjectOperationError extends Error {
  constructor(message, { reason, stage, status = "not-applicable" }) {
    super(message);
    this.name = "VercelProjectOperationError";
    this.reason = reason;
    this.stage = stage;
    this.status = status;
  }
}

export function operationError(message, stage, reason, status) {
  return new VercelProjectOperationError(message, { reason, stage, status });
}

export function responseStatus(response) {
  return Number.isInteger(response?.status) && response.status >= 100 && response.status <= 599
    ? response.status
    : "unavailable";
}

export function renderOperationFailure(error) {
  const stage =
    error instanceof VercelProjectOperationError && safeDiagnosticStages.has(error.stage)
      ? error.stage
      : "internal";
  const reason =
    error instanceof VercelProjectOperationError && safeDiagnosticReasons.has(error.reason)
      ? error.reason
      : "unexpected";
  const status =
    error instanceof VercelProjectOperationError &&
    (error.status === "not-applicable" ||
      error.status === "unavailable" ||
      (Number.isInteger(error.status) && error.status >= 100 && error.status <= 599))
      ? error.status
      : "unavailable";
  return `Vercel empty project operation failed: stage=${stage}; reason=${reason}; status=${status}.\n`;
}

export function normalizeForwardedArguments(arguments_) {
  if (
    arguments_.length === 3 &&
    (arguments_[0] === "apply" || arguments_[0] === "status") &&
    arguments_[1] === "--"
  ) {
    return [arguments_[0], arguments_[2]];
  }
  return arguments_;
}
