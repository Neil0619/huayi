export class UserFacingError extends Error {}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

export function userMessage(error: unknown): string {
  if (error instanceof UserFacingError) return error.message;
  switch (errorCode(error)) {
    case "authentication-failed":
      return "旧密码或恢复码不正确。";
    case "consent-required":
      return "请先阅读并同意该接收方的数据说明。";
    case "invalid-passphrase":
      return "旧密码不能为空。";
    case "invalid-recovery-code":
      return "恢复码格式无效或校验失败。";
    case "invalid-persisted-data":
      return "加密数据已损坏，请从备份恢复。";
    case "legacy-migration-required":
      return "检测到不兼容的旧版本地数据，请清除扩展数据后重新配置。";
    default:
      return "操作失败，请稍后重试。";
  }
}
