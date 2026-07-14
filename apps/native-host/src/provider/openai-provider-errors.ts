import type { AnalysisError, ErrorCode } from "@huayi/protocol";

import { OpenAICredentialError } from "../credentials/openai-keychain.js";

interface ErrorDefinition {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

const ERROR_DEFINITIONS = {
  CANCELLED: { code: "CANCELLED", message: "请求已取消。", retryable: false },
  INTERNAL_ERROR: {
    code: "INTERNAL_ERROR",
    message: "OpenAI 模型服务处理失败，请重试。",
    retryable: true,
  },
  INVALID_RESPONSE: {
    code: "INVALID_RESPONSE",
    message: "模型返回了无效结果，请重试。",
    retryable: true,
  },
  MODEL_PROVIDER_AUTH_FAILED: {
    code: "MODEL_PROVIDER_AUTH_FAILED",
    message: "OpenAI API Key 无效或无权限，请重新配置。",
    retryable: true,
  },
  MODEL_PROVIDER_NOT_CONFIGURED: {
    code: "MODEL_PROVIDER_NOT_CONFIGURED",
    message: "尚未配置 OpenAI API Key，请先运行配置命令。",
    retryable: false,
  },
  NETWORK_ERROR: {
    code: "NETWORK_ERROR",
    message: "无法连接 OpenAI 服务，请检查网络后重试。",
    retryable: true,
  },
  QUOTA_EXCEEDED: {
    code: "QUOTA_EXCEEDED",
    message: "OpenAI API 使用额度已耗尽，请检查用量和账单。",
    retryable: false,
  },
  RATE_LIMITED: {
    code: "RATE_LIMITED",
    message: "OpenAI 请求过于频繁，请稍后再试。",
    retryable: false,
  },
  TIMEOUT: { code: "TIMEOUT", message: "OpenAI 请求超时，请重试。", retryable: true },
} as const satisfies Partial<Record<ErrorCode, ErrorDefinition>>;

type OpenAIErrorCode = keyof typeof ERROR_DEFINITIONS;
export type OpenAIFetchAbortSource = "none" | "timeout" | "user";

export class OpenAIProviderError extends Error {
  readonly code: OpenAIErrorCode;
  readonly retryable: boolean;

  constructor(definition: ErrorDefinition, options?: ErrorOptions) {
    super(definition.message, options);
    this.name = "OpenAIProviderError";
    this.code = definition.code as OpenAIErrorCode;
    this.retryable = definition.retryable;
  }
}

export function openAIProviderError(code: OpenAIErrorCode, cause?: unknown): OpenAIProviderError {
  return new OpenAIProviderError(
    ERROR_DEFINITIONS[code],
    cause === undefined ? undefined : { cause },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInsufficientQuotaBody(body: unknown): boolean {
  if (!isRecord(body) || Object.keys(body).length !== 1 || !isRecord(body.error)) {
    return false;
  }
  const allowedKeys = new Set(["code", "message", "param", "type"]);
  return (
    Object.keys(body.error).every((key) => allowedKeys.has(key)) &&
    body.error.code === "insufficient_quota"
  );
}

export function openAIHttpError(status: number, errorBody?: unknown): OpenAIProviderError {
  if (status >= 300 && status < 400) {
    return openAIProviderError("INVALID_RESPONSE");
  }
  if (status === 401 || status === 403) {
    return openAIProviderError("MODEL_PROVIDER_AUTH_FAILED");
  }
  if (status === 429) {
    return openAIProviderError(
      isInsufficientQuotaBody(errorBody) ? "QUOTA_EXCEEDED" : "RATE_LIMITED",
    );
  }
  if (status >= 400 && status < 500) {
    return openAIProviderError("INVALID_RESPONSE");
  }
  if (status === 502 || status === 503 || status === 504) {
    return openAIProviderError("NETWORK_ERROR");
  }
  return openAIProviderError("INTERNAL_ERROR");
}

function errorDiagnostics(error: unknown, depth = 0): string {
  if (!(error instanceof Error) || depth > 1) {
    return "";
  }
  return `${error.message} ${errorDiagnostics(error.cause, depth + 1)}`.slice(0, 1_024);
}

export function openAIFetchError(
  error: unknown,
  abortSource: OpenAIFetchAbortSource,
): OpenAIProviderError {
  if (abortSource === "user") {
    return openAIProviderError("CANCELLED", error);
  }
  if (abortSource === "timeout") {
    return openAIProviderError("TIMEOUT", error);
  }
  if (/unexpected redirect/i.test(errorDiagnostics(error))) {
    return openAIProviderError("INVALID_RESPONSE", error);
  }
  if (error instanceof TypeError) {
    return openAIProviderError("NETWORK_ERROR", error);
  }
  return openAIProviderError("INTERNAL_ERROR", error);
}

export function mapOpenAIProviderError(error: unknown): AnalysisError {
  if (error instanceof OpenAIProviderError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  if (error instanceof OpenAICredentialError) {
    return mapOpenAIProviderError(openAIProviderError(error.code, error));
  }
  return { ...ERROR_DEFINITIONS.INTERNAL_ERROR };
}
