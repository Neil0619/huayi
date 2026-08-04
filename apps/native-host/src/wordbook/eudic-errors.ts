import type { AnalysisError, ErrorCode } from "@huayi/protocol";

interface ErrorDefinition {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

const ERROR_DEFINITIONS = {
  CANCELLED: { code: "CANCELLED", message: "请求已取消。", retryable: false },
  EUDIC_AUTH_FAILED: {
    code: "EUDIC_AUTH_FAILED",
    message: "欧路授权无效或已过期，请重新配置。",
    retryable: false,
  },
  EUDIC_NOT_CONFIGURED: {
    code: "EUDIC_NOT_CONFIGURED",
    message: "尚未配置欧路授权，请先运行配置命令。",
    retryable: false,
  },
  INTERNAL_ERROR: {
    code: "INTERNAL_ERROR",
    message: "欧路生词本处理失败，请重试。",
    retryable: true,
  },
  INVALID_RESPONSE: {
    code: "INVALID_RESPONSE",
    message: "欧路服务返回了无效数据。",
    retryable: false,
  },
  NETWORK_ERROR: {
    code: "NETWORK_ERROR",
    message: "无法连接欧路服务，请检查网络后重试。",
    retryable: true,
  },
  RATE_LIMITED: {
    code: "RATE_LIMITED",
    message: "欧路请求过于频繁，请稍后再试。",
    retryable: false,
  },
  TIMEOUT: { code: "TIMEOUT", message: "欧路请求超时，请重试。", retryable: true },
  WORD_SYNC_BATCH_MISMATCH: {
    code: "WORD_SYNC_BATCH_MISMATCH",
    message: "扇贝同步批次已失效，请重新打开同步页面。",
    retryable: false,
  },
  WORD_SYNC_BATCH_RESULT_INVALID: {
    code: "WORD_SYNC_BATCH_RESULT_INVALID",
    message: "扇贝返回的未添加词无法验证，本批已保留。",
    retryable: false,
  },
  WORD_SYNC_HISTORY_LIMIT: {
    code: "WORD_SYNC_HISTORY_LIMIT",
    message: "欧路历史生词达到开放接口分页上限，无法确认已完整读取。",
    retryable: false,
  },
  WORD_SYNC_STATE_INVALID: {
    code: "WORD_SYNC_STATE_INVALID",
    message: "生词同步状态文件无效，且无法从备份恢复。",
    retryable: false,
  },
  WORD_SYNC_UNRESOLVED_MISMATCH: {
    code: "WORD_SYNC_UNRESOLVED_MISMATCH",
    message: "未解决词状态已变化，请刷新列表后重试。",
    retryable: false,
  },
} as const satisfies Partial<Record<ErrorCode, ErrorDefinition>>;

export class EudicProviderError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;

  constructor(definition: ErrorDefinition, options?: ErrorOptions) {
    super(definition.message, options);
    this.name = "EudicProviderError";
    this.code = definition.code;
    this.retryable = definition.retryable;
  }
}

export function eudicError(
  code: keyof typeof ERROR_DEFINITIONS,
  cause?: unknown,
): EudicProviderError {
  return new EudicProviderError(
    ERROR_DEFINITIONS[code],
    cause === undefined ? undefined : { cause },
  );
}

export function mapEudicError(error: unknown): AnalysisError {
  if (error instanceof EudicProviderError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return { ...ERROR_DEFINITIONS.INTERNAL_ERROR };
}
