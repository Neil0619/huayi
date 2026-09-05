import { measureLearningPresentation } from "./learning-ui-timing.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LearningTaskError,
  type AnalysisRecord,
  type LearningTaskSnapshot,
  type StudyCaptureDetailResponse,
} from "@huayi/cloud-contracts";
import type { WebStudyCaptureApi } from "./study-capture-api.js";
import type { InboxApi } from "./inbox-app.js";
import { collectionEntries, type CollectionEntry } from "./collection-model.js";
export function useCollectionWorkspace(
  api: WebStudyCaptureApi,
  review: InboxApi,
  key: () => string,
) {
  const [captures, setCaptures] = useState<StudyCaptureDetailResponse[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisRecord[]>([]);
  const [jobs, setJobs] = useState<LearningTaskSnapshot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const [status, setStatus] = useState("");
  const mutation = useRef(false);
  const [cursors, setCursors] = useState<Record<string, string | null>>({});
  const entries = useMemo(
    () => collectionEntries(captures, analyses, jobs),
    [captures, analyses, jobs],
  );
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
        api.tasks?.list().catch(() => []) ?? [],
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
      setSelectedId((id) => id ?? all[0]?.capture.id ?? reviews.items[0]?.id ?? null);
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
        if (live) mergeAnalysis(value);
      })
      .catch(() => {
        if (live) setError("分析结果暂时无法载入，请刷新。");
      });
    return () => {
      live = false;
    };
  }, [review, selected?.capture?.latestAnalysis?.id, selected?.analysis?.id, mergeAnalysis]);
  const taskId = selected?.task?.id;
  useEffect(() => {
    setPreview("");
    if (!taskId || !api.tasks) return;
    const controller = new AbortController();
    const client = api.tasks;
    void (async () => {
      try {
        for await (const event of client.watch(taskId, controller.signal, (snapshot) => {
          if (!controller.signal.aborted)
            setJobs((values) => [snapshot, ...values.filter((value) => value.id !== snapshot.id)]);
        })) {
          if (controller.signal.aborted) return;
          measureLearningPresentation("analysis", performance.now());
          if (event.type === "analysis.preview")
            setPreview((value) => (value + event.text).slice(0, 16000));
          if (event.type === "analysis.completed") {
            mergeAnalysis(event.analysis);
            if (event.analysis.studyCaptureId)
              mergeCapture(await api.getCapture(event.analysis.studyCaptureId));
            setPreview("");
            setStatus("分析已完成，请选择要练习的表达或句型。");
          }
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof LearningTaskError && cause.code === "cancelled"
              ? "生成已停止，原文已保留。"
              : `分析未完成，原文已保留。${cause instanceof LearningTaskError && cause.diagnosticId ? `诊断编号：${cause.diagnosticId}` : ""}`,
          );
      }
    })();
    return () => controller.abort();
  }, [api, taskId, mergeAnalysis, mergeCapture]);
  useEffect(() => {
    if (!api.tasks || !jobs.some((job) => ["queued", "running", "cancelling"].includes(job.state)))
      return;
    const timer = setInterval(() => {
      void api.tasks
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
    if (!entry.capture || !api.tasks) throw new Error("Background analysis is unavailable.");
    let current = entry.capture;
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
    const task = await api.tasks.submit(
      {
        version: 2,
        kind: "capture-analysis",
        captureId: entry.id,
        input: {
          expectedRevision: current.capture.revision,
          intent: current.capture.status === "analyzed" ? "reanalysis" : "initial",
        },
      },
      key(),
    );
    setJobs((values) => [task, ...values.filter((value) => value.id !== task.id)]);
    setStatus("已加入分析队列，可以继续整理其他内容。");
  };
  const paste = (
    sourceText: string,
    metadata: { title: string; userContext: string; kind: "phrase" | "sentence" | "passage" },
    start: boolean,
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
      if (start)
        await analyze(
          { id: current.capture.id, title: metadata.title, sourceText, capture: current },
          metadata,
        );
      else setStatus("已加入收集箱。选择开始深度分析时才会生成学习内容。");
    });
  const cancel = () =>
    act(async () => {
      if (selected?.task && api.tasks) {
        const task = await api.tasks.cancel(selected.task.id);
        setJobs((values) => [task, ...values.filter((value) => value.id !== task.id)]);
        setStatus("已请求停止，正在等待服务器确认。");
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
  const remove = () =>
    act(async () => {
      if (!selected?.capture) return;
      await api.deleteCapture(selected.id, selected.capture.capture.revision, key());
      setCaptures((values) => values.filter((value) => value.capture.id !== selected.id));
      setSelectedId(entries.find((entry) => entry.id !== selected.id)?.id ?? null);
    });
  return {
    entries,
    selected,
    loading,
    busy,
    error,
    preview,
    status,
    load,
    analyze: (entry: CollectionEntry, metadata: Parameters<typeof analyze>[1]) =>
      act(() => analyze(entry, metadata)),
    paste,
    cancel,
    remove,
    more,
    hasMore: Object.values(cursors).some(Boolean),
    mergeAnalysis,
    select(id: string) {
      setSelectedId(id);
      setError("");
      setStatus("");
    },
  };
}
