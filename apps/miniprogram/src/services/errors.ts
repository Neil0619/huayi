export class MiniError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const messages: Record<string, string> = {
  authentication_required: "请重新微信登录，已保存的内容仍会保留。",
  account_link_unavailable:
    "账号密码或关联凭证不可用。请核对语见邮箱和登录密码；若仍失败，请重新微信登录。已开通的两个账号暂不支持合并。密码已清空。",
  account_link_unknown:
    "关联结果尚未确认，密码已清空。请先重新微信登录；若关联已成功，将直接进入原账号。",
  forbidden: "身份验证已失效，或此操作需要再次确认。",
  network_error: "连接中断。输入已保留，请检查网络后重试。",
  quota_exhausted: "本月额度不足。原文与草稿已保留，可稍后继续。",
  rate_limited: "操作较频繁，请稍后重试。",
  operation_in_progress: "已有开通操作正在进行，请等待结果后再尝试。",
  revision_conflict: "这条记录已在其他设备更新。请刷新后核对，当前输入仍保留。",
  exact_duplicate: "学习库已有相同内容，请搜索已有条目后继续整理。",
  generation_busy: "已有任务进行中，请继续当前任务。",
  model_unavailable: "分析服务暂时不可用，可稍后重试。",
  model_output_invalid: "本次结果未能完整生成，原文已保留。",
  not_found: "记录已不存在，请刷新列表。",
  configuration_required: "体验环境尚未配置，请联系维护者完成小程序接入。",
  outcome_unknown: "任务结果待确认，请刷新原任务状态。",
  invalid_request: "请检查输入内容是否符合要求。",
  cancelled: "任务已停止。",
};
export function errorText(error: unknown): string {
  if (error instanceof MiniError) return messages[error.code] ?? "操作未完成，请刷新状态后重试。";
  return "操作未完成，输入已保留。请检查内容并重试。";
}
