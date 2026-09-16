import { EudicClientError, type EudicClientErrorCode } from "../wordbook/eudic-client.js";
import { BackfillError } from "./backfill-errors.js";

const eudicMessages: Record<EudicClientErrorCode, string> = {
  "authentication-failed": "欧路授权已失效，请在设置中重新配置欧路授权。",
  "credential-missing": "尚未配置欧路授权，请在设置中填写欧路授权后重试。",
  "data-corrupt": "无法读取已保存的欧路授权，请在设置中重新配置。",
  "invalid-response": "欧路返回的数据格式异常，请稍后重新检查。",
  "network-error": "无法连接欧路，请检查网络后重试。",
  "rate-limited": "欧路请求受限，请稍后重新检查。",
  timeout: "欧路检查超时，请稍后重试。",
};

export class BackfillDiscoveryError extends Error {
  constructor(
    readonly source: "local" | "cloud" | "eudic",
    error: unknown,
  ) {
    super(
      source === "local"
        ? "无法读取本机收藏，请稍后重新检查。"
        : source === "cloud"
          ? error instanceof BackfillError && error.code === "connection"
            ? "无法连接云端词库，请检查网络后重新检查。"
            : "云端词库检查未完成，请稍后重试。"
          : error instanceof EudicClientError
            ? eudicMessages[error.code]
            : "欧路检查未完成，请稍后重试。",
    );
    this.name = "BackfillDiscoveryError";
  }
}
