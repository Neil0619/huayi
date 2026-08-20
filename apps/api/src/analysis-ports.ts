import type {
  AnalysisRecord,
  AnalysisDeleteResponse,
  ConfirmCandidatesResponse,
  LearningItemContent,
  AnalysisEvent,
  AnalysisRequestStatus,
  ModelUsage,
  QuotaSummary,
  StartAnalysisRequest,
  StudyCaptureAnalyzeRequest,
  StudyCaptureDetailResponse,
  AnalysisContent,
} from "@huayi/cloud-contracts";
import type { DeepSeekPriceSnapshot } from "./deepseek-price-schedule.js";

export interface SegmentedSentence {
  analysisUnitId: string;
  ordinal: number;
  sourceText: string;
}
export interface AnalysisBilledCall {
  costMicroUsd: number;
  usage: ModelUsage;
}
export interface AnalysisModel {
  analyze(command: {
    input: StartAnalysisRequest;
    sentences: readonly SegmentedSentence[];
  }): Promise<{
    billedCalls?: readonly AnalysisBilledCall[];
    content: unknown;
    preview?: string;
    usage?: ModelUsage;
    usageCostMicroUsd?: number;
  }>;
}
export interface AnalysisQuota {
  reserve(command: {
    pricing?: DeepSeekPriceSnapshot;
    requestId: string;
    reservedMicroUsd: number;
    userId: string;
  }): Promise<{ id: string }>;
  settle(command: {
    actualCostMicroUsd?: number;
    billedCalls?: readonly AnalysisBilledCall[];
    outcome: "succeeded" | "failed";
    requestId: string;
    reservationId: string;
    usage?: ModelUsage;
  }): Promise<void> | void;
  summary(userId: string): Promise<QuotaSummary> | QuotaSummary;
}
export interface AnalysisRepository {
  archive(command: AnalysisHistoryMutation): Promise<AnalysisRecord>;
  confirmCandidates(command: ConfirmCandidatesCommand): Promise<ConfirmCandidatesResponse>;
  delete(command: AnalysisHistoryMutation): Promise<AnalysisDeleteResponse>;
  findById(userId: string, id: string): Promise<AnalysisRecord | null>;
  list(
    userId: string,
    query: AnalysisHistoryQuery,
  ): Promise<{ hasMore: boolean; items: AnalysisRecord[] }>;
  processNothingToSave(command: AnalysisHistoryMutation): Promise<AnalysisRecord>;
  replayCandidateConfirmation(
    command: CandidateConfirmationReplayCommand,
  ): Promise<ConfirmCandidatesResponse | null>;
  restore(command: AnalysisHistoryMutation): Promise<AnalysisRecord>;
  save(userId: string, record: AnalysisRecord): Promise<AnalysisRecord>;
}
export interface CandidateConfirmationReplayCommand {
  idempotencyKey: string;
  requestHash: string;
  userId: string;
}
interface ConfirmationTag {
  displayName: string;
  id: string;
  normalizedName: string;
}
interface ConfirmationSourceSnapshot {
  analysisUnitId: string;
  analysisId: string;
  sourceText: string;
  sourceTitle?: string;
  sourceType: "manual" | "study-capture";
  translationZh?: string;
}
interface ConfirmationEntryCommon {
  action: "created" | "merged";
  candidateId: string;
  source: ConfirmationSourceSnapshot;
  targetId: string;
}
export type PreparedCandidateConfirmation = ConfirmationEntryCommon & {
  canonicalKey: string;
  content: LearningItemContent;
  sourceExampleId: string;
  systemAttributes: string[];
  tags: ConfirmationTag[];
  type: "expression" | "sentence-pattern";
};
export interface ConfirmCandidatesCommand {
  analysisId: string;
  expectedRevision: number;
  idempotencyKey: string;
  requestHash: string;
  entries: PreparedCandidateConfirmation[];
  updatedAt: string;
  userId: string;
}
export interface AnalysisHistoryQuery {
  archived: boolean;
  boundary?: { createdAt: string; id: string };
  limit: number;
  query?: string;
  reviewState?: "pendingReview" | "reviewed";
  selectionKind?: "passage" | "phrase" | "sentence";
  sourceType?: "manual" | "study-capture";
}
export interface AnalysisHistoryMutation {
  deleteStudyCapture?: boolean;
  expectedRevision: number;
  id: string;
  idempotencyKey: string;
  requestHash: string;
  updatedAt: string;
  userId: string;
}
export interface AnalysisCommitter {
  complete(command: {
    actualCostMicroUsd?: number;
    billedCalls?: readonly AnalysisBilledCall[];
    record: AnalysisRecord;
    requestId: string;
    reservationId: string;
    leaseToken: string;
    priceVersionId?: string;
    usage?: ModelUsage;
    userId: string;
  }): Promise<{ quota: QuotaSummary; record: AnalysisRecord }>;
  fail(command: {
    actualCostMicroUsd?: number;
    billedCalls?: readonly AnalysisBilledCall[];
    error: Extract<AnalysisEvent, { type: "analysis.failed" }>["error"];
    leaseToken: string;
    priceVersionId?: string;
    requestId: string;
    reservationId: string;
    usage?: ModelUsage;
    userId: string;
  }): Promise<Extract<AnalysisEvent, { type: "analysis.failed" }>>;
}
export type AnalysisRequestClaim =
  | { kind: "acquired"; leaseToken: string; requestId: string }
  | { kind: "running"; requestId: string; unitCount: number }
  | { event: AnalysisEvent; kind: "terminal"; requestId: string };
export interface AnalysisRequestLifecycle {
  attachReservation(command: {
    leaseToken: string;
    priceVersionId?: string;
    requestId: string;
    reservationId: string;
    userId: string;
  }): Promise<void>;
  markDispatched?(command: {
    dispatchedAt: Date;
    leaseToken: string;
    pricing: DeepSeekPriceSnapshot;
    requestId: string;
    userId: string;
  }): Promise<void>;
  begin(command: {
    idempotencyKey: string;
    leaseExpiresAt: Date;
    leaseToken: string;
    requestHash: string;
    requestId: string;
    recoveryLedgerId: string;
    unitCount: number;
    userId: string;
  }): Promise<AnalysisRequestClaim>;
  beginCapture(command: {
    captureId: string;
    expectedRevision: number;
    idempotencyKey: string;
    intent: StudyCaptureAnalyzeRequest["intent"];
    leaseExpiresAt: Date;
    leaseToken: string;
    requestHash: string;
    requestId: string;
    recoveryLedgerId: string;
    unitCount: number;
    userId: string;
  }): Promise<AnalysisRequestClaim>;
  get(userId: string, requestId: string): Promise<AnalysisRequestStatus | null>;
  terminalizeWithoutReservation(command: {
    error: Extract<AnalysisEvent, { type: "analysis.failed" }>["error"];
    leaseToken: string;
    quota: QuotaSummary;
    requestId: string;
    userId: string;
  }): Promise<void>;
}
export interface StudyCaptureReader {
  get(userId: string, captureId: string): Promise<StudyCaptureDetailResponse | null>;
}
export type AnalysisModelContent = AnalysisContent;
