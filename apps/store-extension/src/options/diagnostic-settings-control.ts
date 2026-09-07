import {
  DIAGNOSTIC_CONSENT_KEY,
  DIAGNOSTIC_OUTBOX_KEY,
  diagnosticConsentId,
} from "../service-worker/diagnostic-settings.js";

export async function initializeDiagnosticSettings(
  document: Document,
  storage: {
    get(key: string): Promise<Record<string, unknown>>;
    set(values: Record<string, unknown>): Promise<void>;
    remove(keys: string | string[]): Promise<void>;
  },
): Promise<void> {
  const input = document.querySelector<HTMLInputElement>("[data-diagnostic-consent]");
  const status = document.querySelector<HTMLElement>("[data-diagnostic-status]");
  if (!input || !status) return;
  const show = async () => {
    input.checked =
      diagnosticConsentId((await storage.get(DIAGNOSTIC_CONSENT_KEY))[DIAGNOSTIC_CONSENT_KEY]) !==
      null;
    input.disabled = false;
  };
  try {
    await show();
  } catch {
    status.textContent = "无法读取诊断设置，请重新打开设置页。";
    return;
  }
  input.addEventListener("change", () => {
    const enabled = input.checked;
    input.disabled = true;
    void (async () => {
      try {
        if (enabled)
          await storage.set({
            [DIAGNOSTIC_CONSENT_KEY]: {
              version: 1,
              id: crypto.randomUUID(),
              grantedAt: new Date().toISOString(),
            },
          });
        else {
          await storage.remove(DIAGNOSTIC_CONSENT_KEY);
          await storage.remove(DIAGNOSTIC_OUTBOX_KEY);
        }
        status.textContent = enabled
          ? "自动诊断已开启。连接语见账号后，错误会自动上报。"
          : "自动诊断已关闭，本机待上传日志已清除。";
      } catch {
        status.textContent = "保存失败，请重试。";
      } finally {
        await show();
      }
    })().catch(() => {
      input.disabled = false;
    });
  });
}
