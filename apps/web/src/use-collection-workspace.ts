import { useCollectionAnalysisStream } from "./use-collection-analysis-stream.js";
import {
  assertCaptureAnalysis,
  invalidAnalysisResponse,
  createAnalysisEventBinding,
} from "./analysis-event-binding.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LearningTaskError,
  type AnalysisRecordRead as AnalysisRecord,
  type LearningTaskSnapshotRead as LearningTaskSnapshot,
  type StudyCaptureDetailResponse,
} from "@huayi/cloud-contracts";
import type { WebStudyCaptureApi } from "./study-capture-api.js";
import type { InboxApi } from "./inbox-app.js";
import { collectionEntries, collectionStatus, type CollectionEntry } from "./collection-model.js";
export function useCollectionWorkspace(
  api: WebStudyCaptureApi,
  review: InboxApi,
  key: () => string,
) {
  const [captures, setCaptures] = useState<StudyCaptureDetailResponse[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisRecord[]>([]);
  const [jobs, setJobs] = useState<LearningTaskSnapshot[]>([]);
  // undefined is initial/unselected; null is an explicitly completed review queue.
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const mutation = useRef(false);
  const nativeTaskKinds = useRef(new Map<string, AnalysisRecord["selectionKind"]>());
  const [cursors, setCursors] = useState<Record<string, string | null>>({});
  const entries = useMemo(
    () => collectionEntries(captures, analyses, jobs),
    [captures, analyses, jobs],
  );
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const selected = entries.find((entry) => entry.id === selectedId);
  const mergeAnalysis = useCallback(
    (record: AnalysisRecord) =>
      setAnalyses((values) => [record, ...values.filter((value) => value.id !== record.id)]),
    [],
  );
  const mergeCapture = useCallback(
    (record: StudyCaptureDetailResponse) =>
      setCaptures((values) => [
        record,
        ...values.filter((value) => value.capture.id !== record.capture.id),
      ]),
    [],
  );
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [pending, generating, analyzed, reviews, tasks] = await Promise.all([
        api.listCaptures({ status: "pending", limit: 100 }),
        api.listCaptures({ status: "analyzing", limit: 100 }),
        api.listCaptures({ status: "analyzed", limit: 100 }),
        review.listPending(),
        api.analysisTasks?.list().catch(() => []) ?? [],
      ]);
      const all = [
        ...new Map(
          [...pending.items, ...generating.items, ...analyzed.items].map((value) => [
            value.capture.id,
            value,
          ]),
        ).values(),
      ].sort((a, b) => b.capture.updatedAt.localeCompare(a.capture.updatedAt));
      setCaptures(all);
      setAnalyses(reviews.items);
      setJobs(tasks);
      setCursors({
        pending: pending.nextCursor,
        analyzing: generating.nextCursor,
        analyzed: analyzed.nextCursor,
        review: reviews.nextCursor,
      });
      setSelectedId((id) => (id !== undefined ? id : (all[0]?.capture.id ?? reviews.items[0]?.id)));
    } catch {
      setError("收集箱暂时无法载入，请重试。");
    } finally {
      setLoading(false);
    }
  }, [api, review]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const id = selected?.capture?.latestAnalysis?.id;
    if (!id || selected.analysis) return;
    let live = true;
    void review
      .getAnalysis(id)
      .then((value) => {
        if (live) {
          if (value.id !== id) invalidAnalysisResponse();
          if (selected?.capture) assertCaptureAnalysis(value, selected.capture.capture);
          mergeAnalysis(value);
        }
      })
      .catch(() => {
        if (live) setError("分析结果暂时无法载入，请刷新。");
      });
    return () => {
      live = false;
    };
  }, [
    review,
    selected?.capture?.latestAnalysis?.id,
    selected?.capture?.latestAnalysis?.revision,
    selected?.analysis?.id,
    mergeAnalysis,
  ]);
  const { preview, structureUnits } = useCollectionAnalysisStream({
    requireStructured: nativeTaskKinds.current.has(selected?.task?.id ?? ""),
    expectedSelectionKind: nativeTaskKinds.current.get(selected?.task?.id ?? ""),
    api,
    taskId: selected?.task?.id,
    capture: selected?.capture?.capture,
    selectedIdRef,
    setJobs,
    mergeAnalysis,
    mergeCapture,
    setStatus,
    setError,
  });
  useEffect(() => {
    if (
      !api.analysisTasks ||
      !jobs.some((job) => ["queued", "running", "cancelling"].includes(job.state))
    )
      return;
    const timer = setInterval(() => {
      void api.analysisTasks
        ?.list()
        .then(setJobs)
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [api, jobs.some((job) => ["queued", "running", "cancelling"].includes(job.state))]);
  const act = async (operation: () => Promise<void>) => {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (cause) {
      setError(
        `操作未完成，原文和当前草稿已保留。${cause instanceof LearningTaskError && cause.diagnosticId ? `诊断编号：${cause.diagnosticId}` : ""}`,
      );
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  const analyze = async (
    entry: CollectionEntry,
    metadata: { title: string; userContext: string; kind: "phrase" | "sentence" | "passage" },
  ) => {
    if (!entry.capture || !api.analysisTasks)
      throw new Error("Background analysis is unavailable.");
    let current = entry.capture;
    if (entry.task?.state === "failed" || entry.task?.state === "cancelled") {
      current = await api.getCapture(entry.id);
      mergeCapture(current);
    }
    if (
      current.capture.status !== "analyzing" &&
      (current.capture.kind !== metadata.kind ||
        (current.capture.title ?? "") !== metadata.title ||
        (current.capture.userContext ?? "") !== metadata.userContext)
    ) {
      current = await api.patchCapture(
        entry.id,
        {
          expectedRevision: current.capture.revision,
          kind: metadata.kind,
          title: metadata.title.trim() || null,
          userContext: metadata.userContext.trim() || null,
        },
        key(),
      );
      mergeCapture(current);
    }
    const task = await api.analysisTasks.submit(
      {
        version: 2,
        kind: "capture-analysis",
        captureId: entry.id,
        input: {
          outputContract: "structured-teaching-v1",
          expectedRevision: current.capture.revision,
          intent: current.capture.status === "analyzed" ? "reanalysis" : "initial",
        },
      },
      key(),
    );
    if (task.kind !== "capture-analysis" || task.subjectId !== entry.id) invalidAnalysisResponse();
    if (task.output?.type === "analysis.completed")
      createAnalysisEventBinding({
        sourceText: current.capture.sourceText,
        selectionKind: current.capture.kind,
        captureId: entry.id,
        requireStructured: true,
      }).checkRecord(task.output.analysis);
    nativeTaskKinds.current.set(task.id, current.capture.kind);
    setJobs((values) => [task, ...values.filter((value) => value.id !== task.id)]);
    setStatus("已加入分析队列，可以继续整理其他内容。");
  };
  const paste = (
    sourceText: string,
    metadata: { title: string; userContext: string; kind: "phrase" | "sentence" | "passage" },
    start: boolean,
    onAnalysisAccepted?: () => void,
  ) =>
    act(async () => {
      if (!api.createCapture) throw new Error("Capture is unavailable.");
      const response = await api.createCapture({ sourceText, kind: metadata.kind }, key());
      let current = await api.getCapture(response.capture.id);
      if (
        current.capture.status !== "analyzing" &&
        (metadata.title.trim() || metadata.userContext.trim())
      ) {
        current = await api.patchCapture(
          current.capture.id,
          {
            expectedRevision: current.capture.revision,
            title: metadata.title.trim() || null,
            userContext: metadata.userContext.trim() || null,
          },
          key(),
        );
      }
      mergeCapture(current);
      setSelectedId(current.capture.id);
      if (start) {
        await analyze(
          { id: current.capture.id, title: metadata.title, sourceText, capture: current },
          metadata,
        );
        onAnalysisAccepted?.();
      } else setStatus("已加入收集箱。选择开始深度分析时才会生成学习内容。");
    });
  const cancel = () =>
    act(async () => {
      if (selected?.task && api.analysisTasks) {
        const task = await api.analysisTasks.cancel(selected.task.id);
        setJobs((values) => [task, ...values.filter((value) => value.id !== task.id)]);
        setStatus("已请求停止，正在等待服务器确认。");
      }
    });
  const recover = () =>
    act(async () => {
      const current = selected?.capture;
      const requestId = current?.activeAnalysisRequest?.requestId;
      if (!current || !requestId || selected.task) return;
      const result = await api.getAnalysisRequestStatus(requestId);
      mergeCapture(await api.getCapture(current.capture.id));
      if (result.state === "completed") {
        const record = await review.getAnalysis(result.analysisId);
        if (record.id !== result.analysisId) invalidAnalysisResponse();
        assertCaptureAnalysis(record, current.capture);
        mergeAnalysis(record);
      }
      if (selectedIdRef.current !== current.capture.id) return;
      if (result.state === "failed") {
        setStatus("");
        setError("深度分析失败，原文已保留，可稍后重试；重新分析失败时会保留之前的结果。");
      } else {
        setStatus(
          result.state === "running"
            ? "服务器仍在处理同一次分析，请稍后检查。"
            : "分析已完成，请选择要练习的表达或句型。",
        );
      }
    });
  const more = () =>
    act(async () => {
      for (const [category, cursor] of Object.entries(cursors)) {
        if (!cursor) continue;
        if (category === "review") {
          const page = await review.listPending({ cursor });
          page.items.forEach(mergeAnalysis);
          setCursors((values) => ({ ...values, review: page.nextCursor }));
        } else if (category === "pending" || category === "analyzing" || category === "analyzed") {
          const page = await api.listCaptures({ status: category, cursor, limit: 100 });
          page.items.forEach(mergeCapture);
          setCursors((values) => ({ ...values, [category]: page.nextCursor }));
        }
      }
    });
  const completeReview = (entryId: string, record: AnalysisRecord) => {
    mergeAnalysis(record);
    if (selectedIdRef.current !== entryId) return;
    const next = entriesRef.current.find(
      (entry) => entry.id !== entryId && collectionStatus(entry) === "待选择学习内容",
    );
    setSelectedId(next?.id ?? null);
    setStatus("");
  };
  // Loading another page or refreshing may reveal more review-ready content.
  useEffect(() => {
    if (selectedId !== null) return;
    const next = entries.find((entry) => collectionStatus(entry) === "待选择学习内容");
    if (next) setSelectedId(next.id);
  }, [entries, selectedId]);
  const remove = () =>
    act(async () => {
      if (!selected?.capture) return;
      await api.deleteCapture(selected.id, selected.capture.capture.revision, key());
      setCaptures((values) => values.filter((value) => value.capture.id !== selected.id));
      setSelectedId(entries.find((entry) => entry.id !== selected.id)?.id);
    });
  return {
    entries,
    selected,
    loading,
    busy,
    error,
    preview,
    structureUnits,
    status,
    load,
    analyze: (entry: CollectionEntry, metadata: Parameters<typeof analyze>[1]) =>
      act(() => analyze(entry, metadata)),
    paste,
    cancel,
    recover,
    remove,
    more,
    hasMore: Object.values(cursors).some(Boolean),
    completeReview,
    reviewComplete: selectedId === null,
    select(id: string) {
      selectedIdRef.current = id;
      setSelectedId(id);
      setError("");
      setStatus("");
    },
  };
}
