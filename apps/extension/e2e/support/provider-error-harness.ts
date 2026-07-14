import { SCHEMA_VERSION } from "@huayi/protocol";
import type { AnalyzeRequest, HostEvent } from "@huayi/protocol";

export function createProviderErrorEvent(request: AnalyzeRequest): HostEvent | null {
  if (request.selection !== "apiunconfigured" && request.selection !== "apiauthfailed") {
    return null;
  }
  const authFailed = request.selection === "apiauthfailed";
  return {
    error: {
      code: authFailed ? "MODEL_PROVIDER_AUTH_FAILED" : "MODEL_PROVIDER_NOT_CONFIGURED",
      message: authFailed
        ? "OpenAI API Key 无效或无权限，请重新配置。"
        : "尚未配置 OpenAI API Key，请先运行配置命令。",
      retryable: authFailed,
    },
    requestId: request.requestId,
    schemaVersion: SCHEMA_VERSION,
    type: "error",
  };
}
