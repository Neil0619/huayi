import type { AnalysisError, WordSyncStatusEvent } from "@huayi/protocol";

export interface WordSyncPresentation {
  badge: string;
  title: string;
}

export function wordSyncBadgeText(count: number): string {
  if (count === 0) return "";
  return count > 999 ? "999+" : String(count);
}

export function wordSyncCountsPresentation(
  pendingCount: number,
  unresolvedCount: number,
): WordSyncPresentation {
  const badge = pendingCount > 0 ? wordSyncBadgeText(pendingCount) : unresolvedCount > 0 ? "!" : "";
  let title =
    pendingCount === 0 ? "语见：暂无待同步生词" : `语见：${pendingCount} 个生词待同步到扇贝`;
  if (unresolvedCount > 0) title += `；${unresolvedCount} 个词需要人工处理`;
  return { badge, title };
}

export function wordSyncStatusPresentation(status: WordSyncStatusEvent): WordSyncPresentation {
  const presentation = wordSyncCountsPresentation(status.pendingCount, status.unresolvedCount);
  const attention =
    status.pendingCount === 0 &&
    (status.unresolvedCount > 0 || !status.historyComplete || !status.lastPollSucceeded);
  let title = presentation.title;
  if (!status.historyComplete) title += "；欧路历史尚未完整读取";
  if (!status.lastPollSucceeded) title += "；最近一次欧路检查失败";
  if (status.skippedCount > 0) title += `；已跳过 ${status.skippedCount} 个非单词条目`;
  return { badge: attention ? "!" : presentation.badge, title };
}

export function wordSyncFailurePresentation(
  status: WordSyncStatusEvent | null,
  error: AnalysisError,
): WordSyncPresentation {
  const pendingCount = status?.pendingCount ?? 0;
  const unresolvedCount = status?.unresolvedCount ?? 0;
  const presentation = wordSyncCountsPresentation(pendingCount, unresolvedCount);
  return {
    badge: pendingCount > 0 ? presentation.badge : "!",
    title: `${presentation.title}；${error.message}`,
  };
}
