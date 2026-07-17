import type { AnalysisError, ErrorCode } from "@huayi/protocol";

import { DeepSeekCredentialError } from "../credentials/deepseek-keychain.js";

interface ErrorDefinition {
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

const DEFINITIONS = {
  CANCELLED: { code: "CANCELLED", message: "请求已取消。", retryable: false },
  INTERNAL_ERROR: {
    code: "INTERNAL_ERROR",
    message: "DeepSeek 模型服务处理失败，请重试。",
    retryable: true,
  },
  INVALID_RESPONSE: {
    code: "INVALID_RESPONSE",
    message: "DeepSeek 返回了无效结果，请重试。",
    retryable: true,
  },
  MODEL_PROVIDER_AUTH_FAILED: {
    code: "MODEL_PROVIDER_AUTH_FAILED",
    message: "DeepSeek API Key 无效或无权限，请重新配置。",
    retryable: true,
  },
  MODEL_PROVIDER_NOT_CONFIGURED: {
    code: "MODEL_PROVIDER_NOT_CONFIGURED",
    message: "尚未配置 DeepSeek API Key，请先运行配置命令。",
    retryable: false,
  },
  NETWORK_ERROR: {
    code: "NETWORK_ERROR",
    message: "无法连接 DeepSeek 服务，请检查网络后重试。",
    retryable: true,
  },
  QUOTA_EXCEEDED: {
    code: "QUOTA_EXCEEDED",
    message: "DeepSeek API 余额不足，请检查账户余额。",
    retryable: false,
  },
  RATE_LIMITED: {
    code: "RATE_LIMITED",
    message: "DeepSeek 请求过于频繁，请稍后再试。",
    retryable: false,
  },
  TIMEOUT: { code: "TIMEOUT", message: "DeepSeek 请求超时，请重试。", retryable: true },
} as const satisfies Partial<Record<ErrorCode, ErrorDefinition>>;

export type DeepSeekProviderErrorCode = keyof typeof DEFINITIONS;
export type DeepSeekFetchAbortSource = "none" | "timeout" | "user";

export class DeepSeekProviderError extends Error {
  readonly code: DeepSeekProviderErrorCode;
  readonly retryable: boolean;

  constructor(definition: ErrorDefinition) {
    super(definition.message);
    this.name = "DeepSeekProviderError";
    this.code = definition.code as DeepSeekProviderErrorCode;
    this.retryable = definition.retryable;
  }
}

export function deepSeekProviderError(code: DeepSeekProviderErrorCode): DeepSeekProviderError {
  return new DeepSeekProviderError(DEFINITIONS[code]);
}

export function deepSeekHttpError(status: number): DeepSeekProviderError {
  if (status === 401 || status === 403) return deepSeekProviderError("MODEL_PROVIDER_AUTH_FAILED");
  if (status === 402) return deepSeekProviderError("QUOTA_EXCEEDED");
  if (status === 429) return deepSeekProviderError("RATE_LIMITED");
  if ([500, 502, 503, 504].includes(status)) return deepSeekProviderError("NETWORK_ERROR");
  if (status >= 300 && status < 500) return deepSeekProviderError("INVALID_RESPONSE");
  return deepSeekProviderError("INTERNAL_ERROR");
}

function diagnostic(error: unknown, depth = 0): string {
  if (!(error instanceof Error) || depth > 1) return "";
  return `${error.message} ${diagnostic(error.cause, depth + 1)}`.slice(0, 1_024);
}

export function deepSeekFetchError(
  error: unknown,
  abortSource: DeepSeekFetchAbortSource,
): DeepSeekProviderError {
  if (abortSource === "user") return deepSeekProviderError("CANCELLED");
  if (abortSource === "timeout") return deepSeekProviderError("TIMEOUT");
  if (/unexpected redirect/i.test(diagnostic(error)))
    return deepSeekProviderError("INVALID_RESPONSE");
  if (error instanceof TypeError) return deepSeekProviderError("NETWORK_ERROR");
  return deepSeekProviderError("INTERNAL_ERROR");
}

export function mapDeepSeekProviderError(error: unknown): AnalysisError {
  if (error instanceof DeepSeekProviderError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  if (error instanceof DeepSeekCredentialError) {
    return mapDeepSeekProviderError(deepSeekProviderError(error.code));
  }
  return { ...DEFINITIONS.INTERNAL_ERROR };
}
