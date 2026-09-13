import { useEffect, useState, type Dispatch, type SetStateAction, type RefObject } from "react";
import {
  analysisEventReadSchema,
  type AnalysisRecordRead,
  type LearningTaskSnapshotRead,
  type StructuredSentenceUnit,
  type StudyCaptureDetailResponse,
} from "@huayi/cloud-contracts";
import { createAnalysisEventBinding, invalidAnalysisResponse } from "./analysis-event-binding.js";
import { measureLearningPresentation } from "./learning-ui-timing.js";
import { learningTaskFeedback } from "./learning-task-feedback.js";
import type { WebStudyCaptureApi } from "./study-capture-api.js";

export function useCollectionAnalysisStream(options: {
  requireStructured: boolean;
  expectedSelectionKind?: AnalysisRecordRead["selectionKind"] | undefined;
  api: WebStudyCaptureApi;
  taskId: string | undefined;
  capture: StudyCaptureDetailResponse["capture"] | undefined;
  selectedIdRef: RefObject<string | null | undefined>;
  setJobs: Dispatch<SetStateAction<LearningTaskSnapshotRead[]>>;
  mergeAnalysis(record: AnalysisRecordRead): void;
  mergeCapture(record: StudyCaptureDetailResponse): void;
  setStatus(status: string): void;
  setError(error: string): void;
}) {
  const {
    requireStructured,
    expectedSelectionKind,
    api,
    taskId,
    capture,
    selectedIdRef,
    setJobs,
    mergeAnalysis,
    mergeCapture,
    setStatus,
    setError,
  } = options;
  const captureId = capture?.id,
    sourceText = capture?.sourceText;
  // Current metadata may have changed since a recovered task was submitted.
  const selectionKind = expectedSelectionKind;
  const scope = JSON.stringify([taskId, captureId, sourceText, selectionKind]);
  const [previewScope, setPreviewScope] = useState(scope);
  const [preview, setPreview] = useState("");
  const [structureUnits, setStructureUnits] = useState<StructuredSentenceUnit[]>([]);
  useEffect(() => {
    setPreviewScope(scope);
    setPreview("");
    setStructureUnits([]);
    if (!taskId || !api.analysisTasks || !captureId || sourceText === undefined) return;
    const controller = new AbortController();
    const client = api.analysisTasks;
    const binding = createAnalysisEventBinding({
      sourceText,
      ...(selectionKind === undefined ? {} : { selectionKind }),
      captureId,
      requireStructured,
    });
    let terminalFailure = false;
    void (async () => {
      try {
        for await (const payload of client.watch(taskId, controller.signal, (snapshot) => {
          if (controller.signal.aborted) return;
          if (
            snapshot.id !== taskId ||
            snapshot.kind !== "capture-analysis" ||
            snapshot.subjectId !== captureId
          )
            invalidAnalysisResponse();
          if (snapshot.output !== null) {
            const output = analysisEventReadSchema.parse(snapshot.output);
            if (output.type === "analysis.completed") binding.checkRecord(output.analysis);
          }
          terminalFailure = snapshot.state === "failed" || snapshot.state === "cancelled";
          if (terminalFailure) {
            setPreview("");
            setStructureUnits([]);
          }
          setJobs((values) => [snapshot, ...values.filter((value) => value.id !== snapshot.id)]);
        })) {
          if (controller.signal.aborted) return;
          const event = binding.accept(analysisEventReadSchema.parse(payload));
          measureLearningPresentation("analysis", performance.now());
          if (event.type === "analysis.preview")
            setPreview((value) => (value + event.text).slice(0, 16000));
          if (event.type === "analysis.structure")
            setStructureUnits((values) => [...values, event.unit]);
          if (event.type === "analysis.completed") {
            mergeAnalysis(event.analysis);
            const current = await api.getCapture(captureId);
            if (controller.signal.aborted) return;
            mergeCapture(current);
            setPreview("");
            setStructureUnits([]);
            setStatus("分析已完成，请选择要练习的表达或句型。");
          }
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        setStructureUnits([]);
        if (terminalFailure) {
          const current = await api.getCapture(captureId).catch(() => null);
          if (controller.signal.aborted) return;
          if (current) mergeCapture(current);
        }
        if (selectedIdRef.current !== captureId) return;
        setStatus("");
        setError(learningTaskFeedback(cause, "analysis"));
      }
    })();
    return () => controller.abort();
  }, [
    requireStructured,
    scope,
    api,
    taskId,
    captureId,
    sourceText,
    selectionKind,
    selectedIdRef,
    setJobs,
    mergeAnalysis,
    mergeCapture,
    setStatus,
    setError,
  ]);
  return {
    preview: previewScope === scope ? preview : "",
    structureUnits: previewScope === scope ? structureUnits : [],
  };
}
