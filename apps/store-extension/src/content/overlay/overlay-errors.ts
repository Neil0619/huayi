import type { StoreAnalysisErrorCode } from "@huayi/store-domain";

export interface OverlayErrorPresentation {
  readonly message: string;
  readonly optionsAction: boolean;
  readonly retry: boolean;
}

const PRESENTATIONS: Readonly<Record<StoreAnalysisErrorCode, OverlayErrorPresentation>> = {
  busy: { message: "已有分析正在进行，请稍后再试。", optionsAction: false, retry: true },
  cancelled: { message: "分析已取消。", optionsAction: false, retry: true },
  "consent-required": {
    message: "分析前需要先阅读并同意数据传输说明。",
    optionsAction: true,
    retry: true,
  },
  "credential-missing": {
    message: "当前模型服务尚未配置密钥。",
    optionsAction: true,
    retry: true,
  },
  "internal-error": { message: "扩展暂时无法完成分析。", optionsAction: false, retry: true },
  "invalid-request": {
    message: "所选内容无法分析，请重新选择。",
    optionsAction: false,
    retry: false,
  },
  "invalid-response": { message: "模型返回了无效响应。", optionsAction: false, retry: true },
  "network-error": {
    message: "网络连接失败，请检查网络后重试。",
    optionsAction: false,
    retry: true,
  },
  "provider-error": {
    message: "模型服务返回错误，请稍后重试。",
    optionsAction: false,
    retry: true,
  },
  timeout: { message: "分析请求超时，请手动重试。", optionsAction: false, retry: true },
  "version-mismatch": {
    message: "扩展已更新，请刷新当前页面后再试。",
    optionsAction: false,
    retry: false,
  },
};

export function overlayErrorPresentation(code: StoreAnalysisErrorCode): OverlayErrorPresentation {
  return PRESENTATIONS[code];
}
