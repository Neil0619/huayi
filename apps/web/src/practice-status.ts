import type { PracticeHistorySummary } from "@huayi/cloud-contracts";
const statusText = {
  active: "进行中",
  "awaiting-feedback": "等待生成或反馈",
  completed: "已完成",
  failed: "未完成",
};
export function practiceStatus(
  status: PracticeHistorySummary["status"],
  phase?: PracticeHistorySummary["workspacePhase"],
) {
  if (phase === "paused") return "已暂停";
  if (phase === "skipped") return "已跳过";
  if (phase === "ended") return status === "completed" ? "已完成并结束" : "已结束，未完成";
  return statusText[status];
}
