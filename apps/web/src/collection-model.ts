import type {
  AnalysisRecord,
  LearningTaskSnapshot,
  StudyCaptureDetailResponse,
} from "@huayi/cloud-contracts";
export interface CollectionEntry {
  id: string;
  sourceText: string;
  title: string;
  capture?: StudyCaptureDetailResponse;
  analysis?: AnalysisRecord;
  task?: LearningTaskSnapshot;
}
export function collectionEntries(
  captures: StudyCaptureDetailResponse[],
  analyses: AnalysisRecord[],
  jobs: LearningTaskSnapshot[],
): CollectionEntry[] {
  const attached = new Set(
    captures.flatMap((capture) => (capture.latestAnalysis ? [capture.latestAnalysis.id] : [])),
  );
  return [
    ...captures.map((capture) => {
      const task = jobs.find(
        (job) => job.kind === "capture-analysis" && job.subjectId === capture.capture.id,
      );
      const completed =
        task?.output?.type === "analysis.completed" ? task.output.analysis : undefined;
      const analysis =
        analyses.find((item) => item.id === (completed?.id ?? capture.latestAnalysis?.id)) ??
        completed;
      return {
        id: capture.capture.id,
        sourceText: capture.capture.sourceText,
        title: capture.capture.title ?? "",
        capture,
        ...(analysis ? { analysis } : {}),
        ...(task ? { task } : {}),
      };
    }),
    ...analyses
      .filter(
        (analysis) =>
          !attached.has(analysis.id) &&
          !captures.some((capture) => capture.capture.id === analysis.studyCaptureId),
      )
      .map((analysis) => ({
        id: analysis.id,
        sourceText: analysis.sourceText,
        title: analysis.source.title ?? "",
        analysis,
      })),
  ];
}
export function collectionStatus(entry: CollectionEntry) {
  if (
    entry.task &&
    ["queued", "running", "cancelling", "unknown", "failed", "cancelled"].includes(entry.task.state)
  )
    return {
      queued: "排队中",
      running: "生成中",
      cancelling: "正在停止",
      unknown: "结果待核对",
      failed: "分析失败",
      cancelled: "已停止",
    }[entry.task.state as "queued" | "running" | "cancelling" | "unknown" | "failed" | "cancelled"];
  const review = entry.analysis?.reviewState ?? entry.capture?.latestAnalysis?.reviewState;
  if (review) return review === "reviewed" ? "已整理" : "待选择学习内容";
  return entry.capture?.capture.status === "analyzing" ? "生成中" : "待分析";
}
