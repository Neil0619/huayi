import {
  LearningTaskError,
  analysisRecordReadSchema,
  analysisRequestStatusSchema,
  segmentSentenceSource,
  structuredSentenceUnitSchema,
  type AnalysisEventRead,
  type AnalysisRecordRead,
  type StructuredSentenceUnit,
  type StudyCaptureDetailResponse,
} from "@huayi/cloud-contracts";

export function invalidAnalysisResponse(): never {
  throw new LearningTaskError("invalid_response");
}
export function assertCaptureAnalysis(
  record: AnalysisRecordRead,
  capture: StudyCaptureDetailResponse["capture"],
) {
  if (record.studyCaptureId !== capture.id || record.sourceText !== capture.sourceText)
    invalidAnalysisResponse();
}
/** Binds independently valid units to one active source, request and terminal result. */
export function createAnalysisEventBinding(options: {
  sourceText: string;
  selectionKind?: AnalysisRecordRead["selectionKind"];
  captureId?: string;
  requireStructured?: boolean;
}) {
  let partition: ReturnType<typeof segmentSentenceSource> | undefined;
  const units: StructuredSentenceUnit[] = [];
  let requestId: string | undefined;
  let unitCount: number | undefined;
  let terminal = false;
  function checkRecord(value: AnalysisRecordRead) {
    const record = analysisRecordReadSchema.parse(value);
    if (
      record.sourceText !== options.sourceText ||
      (options.selectionKind !== undefined && record.selectionKind !== options.selectionKind) ||
      (options.captureId !== undefined && record.studyCaptureId !== options.captureId)
    )
      invalidAnalysisResponse();
    const result = record.result;
    if (
      options.requireStructured &&
      result.type !== "phrase-analysis-v3" &&
      result.type !== "sentence-passage-analysis-v3"
    )
      invalidAnalysisResponse();
    if (units.length > 0 && result.type !== "sentence-passage-analysis-v3")
      invalidAnalysisResponse();
    if (result.type === "sentence-passage-analysis-v3") {
      if (unitCount !== undefined && unitCount !== result.sentences.length)
        invalidAnalysisResponse();
      for (const unit of units) {
        const final = result.sentences[unit.ordinal];
        if (
          !final ||
          final.analysisUnitId !== unit.analysisUnitId ||
          final.sourceText !== unit.sourceText ||
          JSON.stringify(final.sentenceStructure) !== JSON.stringify(unit.sentenceStructure)
        )
          invalidAnalysisResponse();
      }
    }
    return record;
  }
  return {
    checkRecord,
    accept(event: AnalysisEventRead): AnalysisEventRead {
      if (terminal) invalidAnalysisResponse();
      if ("requestId" in event) {
        if (requestId !== undefined && requestId !== event.requestId) invalidAnalysisResponse();
      }
      if (event.type === "analysis.started") {
        if (unitCount !== undefined || units.length > 0) invalidAnalysisResponse();
        unitCount = event.unitCount;
      }
      if (event.type === "analysis.structure") {
        const unit = structuredSentenceUnitSchema.parse(event.unit);
        if (options.selectionKind === "phrase") invalidAnalysisResponse();
        partition ??= segmentSentenceSource(options.sourceText);
        const expected = partition[unit.ordinal];
        const previous = units.at(-1);
        if (
          !expected ||
          expected.analysisUnitId !== unit.analysisUnitId ||
          expected.sourceText !== unit.sourceText ||
          (previous && previous.ordinal >= unit.ordinal)
        )
          invalidAnalysisResponse();
        units.push(unit);
      }
      if (event.type === "analysis.completed") {
        checkRecord(event.analysis);
        terminal = true;
      }
      if (event.type === "analysis.failed") terminal = true;
      if ("requestId" in event) requestId = event.requestId;
      return event;
    },
  };
}

export function readBoundAnalysisStatus(requestId: string, value: unknown) {
  const status = analysisRequestStatusSchema.parse(value);
  if (status.requestId !== requestId) invalidAnalysisResponse();
  return status;
}
