import type { AnalysisError, ErrorCode } from "@huayi/protocol";

import { OpenAICredentialError } from "../credentials/openai-keychain.js";
import { OpenAIProviderError, mapOpenAIProviderError } from "../provider/openai-provider-errors.js";
import type { ProviderValidationError } from "../provider/provider-validation.js";

interface CodexProcessFailure {
  aborted?: boolean;
  exitCode: number | null;
  stderr: string;
  timedOut?: boolean;
}

interface ErrorDefinition {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

const ERROR_DEFINITIONS = {
  CANCELLED: { code: "CANCELLED", message: "请求已取消。", retryable: false },
  CODEX_CAPABILITY_MISSING: {
    code: "CODEX_CAPABILITY_MISSING",
    message: "当前 Codex CLI 缺少划译所需能力，请升级后重试。",
    retryable: false,
  },
  CODEX_NOT_AUTHENTICATED: {
    code: "CODEX_NOT_AUTHENTICATED",
    message: "Codex 尚未通过 ChatGPT 登录，请先运行 codex login。",
    retryable: false,
  },
  INTERNAL_ERROR: {
    code: "INTERNAL_ERROR",
    message: "本机模型服务处理失败，请重试。",
    retryable: true,
  },
  INVALID_RESPONSE: {
    code: "INVALID_RESPONSE",
    message: "模型返回了无效结果，请重试。",
    retryable: true,
  },
  NETWORK_ERROR: {
    code: "NETWORK_ERROR",
    message: "网络连接失败，请检查网络后重试。",
    retryable: true,
  },
  QUOTA_EXCEEDED: {
    code: "QUOTA_EXCEEDED",
    message: "当前 ChatGPT 使用额度已耗尽，请稍后再试。",
    retryable: false,
  },
  RATE_LIMITED: {
    code: "RATE_LIMITED",
    message: "请求过于频繁，请稍后重试。",
    retryable: true,
  },
  TIMEOUT: { code: "TIMEOUT", message: "模型响应超时，请重试。", retryable: true },
} as const satisfies Partial<Record<ErrorCode, ErrorDefinition>>;

export class CodexProviderError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, retryable: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = "CodexProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

function providerError(definition: ErrorDefinition, options?: ErrorOptions): CodexProviderError {
  return new CodexProviderError(definition.code, definition.message, definition.retryable, options);
}

export function mapCodexProcessFailure(failure: CodexProcessFailure): CodexProviderError {
  if (failure.aborted === true) {
    return providerError(ERROR_DEFINITIONS.CANCELLED);
  }
  if (failure.timedOut === true) {
    return providerError(ERROR_DEFINITIONS.TIMEOUT);
  }

  const diagnostics = failure.stderr.toLowerCase();
  if (/invalid[_ ]json[_ ]schema|unsupported value.*reasoning(?:\.|_)effort/.test(diagnostics)) {
    return providerError(ERROR_DEFINITIONS.CODEX_CAPABILITY_MISSING);
  }
  if (
    /not (?:logged|signed) in|authentication required|unauthorized|login required/.test(diagnostics)
  ) {
    return providerError(ERROR_DEFINITIONS.CODEX_NOT_AUTHENTICATED);
  }
  if (/quota|usage limit|credits? (?:are )?exhausted|billing limit/.test(diagnostics)) {
    return providerError(ERROR_DEFINITIONS.QUOTA_EXCEEDED);
  }
  if (/429|too many requests|rate.?limit/.test(diagnostics)) {
    return providerError(ERROR_DEFINITIONS.RATE_LIMITED);
  }
  if (/network|connection|dns|econn|timed? out|tls|socket/.test(diagnostics)) {
    return providerError(ERROR_DEFINITIONS.NETWORK_ERROR);
  }
  return providerError(ERROR_DEFINITIONS.INTERNAL_ERROR);
}

function turnFailureDiagnostics(failure: unknown, depth = 0): string {
  if (typeof failure === "string") {
    return failure.slice(0, 8_192);
  }
  if (failure instanceof Error) {
    return failure.message.slice(0, 8_192);
  }
  if (depth >= 3 || typeof failure !== "object" || failure === null || Array.isArray(failure)) {
    return "";
  }

  const record = failure as Record<string, unknown>;
  return ["code", "details", "error", "message"]
    .map((key) => turnFailureDiagnostics(record[key], depth + 1))
    .filter((value) => value.length > 0)
    .join(" ")
    .slice(0, 8_192);
}

export function mapCodexTurnFailure(failure: unknown): CodexProviderError {
  return mapCodexProcessFailure({
    exitCode: null,
    stderr: turnFailureDiagnostics(failure),
  });
}

export function mapProviderValidationFailure(failure: ProviderValidationError): CodexProviderError {
  switch (failure.stage) {
    case "stream-parse":
    case "model-json":
    case "model-schema":
      return providerError(ERROR_DEFINITIONS.INVALID_RESPONSE, { cause: failure });
    case "result-assembly":
    case "protocol-validation":
      return providerError(ERROR_DEFINITIONS.INTERNAL_ERROR, { cause: failure });
  }
}

export function mapCodexError(error: unknown): AnalysisError {
  if (error instanceof CodexProviderError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return { ...ERROR_DEFINITIONS.INTERNAL_ERROR };
}

export function mapAnalysisProviderError(error: unknown): AnalysisError {
  if (error instanceof OpenAIProviderError || error instanceof OpenAICredentialError) {
    return mapOpenAIProviderError(error);
  }
  return mapCodexError(error);
}

export function capabilityMissingError(cause?: unknown): CodexProviderError {
  return providerError(ERROR_DEFINITIONS.CODEX_CAPABILITY_MISSING, { cause });
}

export function notAuthenticatedError(cause?: unknown): CodexProviderError {
  return providerError(ERROR_DEFINITIONS.CODEX_NOT_AUTHENTICATED, { cause });
}

export function invalidResponseError(cause?: unknown): CodexProviderError {
  return providerError(ERROR_DEFINITIONS.INVALID_RESPONSE, { cause });
}
