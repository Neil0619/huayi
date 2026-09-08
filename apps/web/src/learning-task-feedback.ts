import { LearningTaskError } from "@huayi/cloud-contracts";
import { WebPracticeApiError } from "./practice-api.js";

export function learningTaskFeedback(cause: unknown, activity: "analysis" | "practice") {
  const code =
    cause instanceof LearningTaskError || cause instanceof WebPracticeApiError
      ? cause.code
      : "unknown";
  const saved = activity === "analysis" ? "原文已保留" : "已保存的练习和草稿会保留";
  const messages: Record<string, string> = {
    model_output_invalid:
      activity === "analysis"
        ? `AI 返回的分析内容不完整或格式不正确，${saved}。请稍后点击“重试深度分析”。`
        : `AI 返回的内容不完整或格式不正确，${saved}。请重试当前步骤。`,
    generation_busy: `还有一项练习或生成正在进行，${saved}。请先继续或暂停已有练习，再开始新的练习。`,
    outcome_unknown: `正在核对同一次${activity === "analysis" ? "分析" : "生成"}的结果，${saved}。请稍后刷新查看。`,
    cancelled: `生成已停止，${saved}。`,
    quota_exhausted: `本期平台额度不足，${saved}。请到设置查看额度。`,
    rate_limited: `请求较多，请稍后重试。${saved}。`,
    model_unavailable: `AI 服务暂时不可用，${saved}。请稍后重试。`,
    model_timeout:
      activity === "analysis"
        ? `本次分析超时，${saved}。可以稍后重试，或把长段落拆成较短内容。`
        : `本次生成超时，${saved}。请重试当前步骤。`,
    model_response_invalid: `AI 服务返回异常，${saved}。请稍后重试。`,
    revision_conflict: `练习状态已更新，${saved}。请返回列表重新打开这次练习。`,
  };
  const message = messages[code] ?? `连接暂时中断，${saved}。请刷新查看已有结果后再重试。`;
  return `${message}${cause instanceof LearningTaskError && cause.diagnosticId ? `诊断编号：${cause.diagnosticId}` : ""}`;
}
