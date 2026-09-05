import type { StoreAnalysisErrorCode } from "@huayi/store-domain";

export interface OverlayErrorPresentation {
  readonly message: string;
  readonly optionsAction: boolean;
  readonly retry: boolean;
}

const PRESENTATIONS: Readonly<
  Record<StoreAnalysisErrorCode, readonly [message: string, optionsAction: boolean, retry: boolean]>
> = {
  busy: ["已有分析正在进行，请稍后再试。", false, true],
  cancelled: ["分析已取消。", false, true],
  "cloud-access-denied": [
    "账号服务拒绝了此插件的请求。请确认使用最新的语见插件后重试。",
    true,
    true,
  ],
  "cloud-session-required": ["账号关联已失效，请打开设置重新连接。", true, true],
  "consent-required": ["分析前需要先阅读并同意数据传输说明。", true, true],
  "credential-missing": ["当前模型服务尚未配置密钥。", true, true],
  "internal-error": ["扩展暂时无法完成分析。", false, true],
  "invalid-request": ["所选内容无法分析，请重新选择。", false, false],
  "invalid-response": ["模型返回了无效响应。", false, true],
  "network-error": ["网络连接失败，请检查网络后重试。", false, true],
  "provider-error": ["模型服务返回错误，请稍后重试。", false, true],
  "quota-exhausted": ["平台模型额度已用完，请前往 Web 端查看额度或切换为自备 Key。", false, false],
  timeout: ["分析请求超时，请手动重试。", false, true],
  "version-mismatch": ["请更新语见插件并刷新当前页面后重试。", false, false],
};

export function overlayErrorPresentation(code: StoreAnalysisErrorCode): OverlayErrorPresentation {
  const [message, optionsAction, retry] = PRESENTATIONS[code];
  return { message, optionsAction, retry };
}
