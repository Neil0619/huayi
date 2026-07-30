import {
  SCHEMA_VERSION,
  addWordRequestSchema,
  analyzeRequestSchema,
  checkWordRequestSchema,
  requestIdSchema,
  wordSyncDiscardAllUnresolvedRequestSchema,
  wordSyncDiscardUnresolvedRequestSchema,
  wordSyncListUnresolvedRequestSchema,
  wordSyncRequeueUnresolvedRequestSchema,
  wordSyncResolveBatchRequestSchema,
} from "@huayi/protocol";
import type {
  AddWordRequest,
  AnalysisError,
  AnalyzeRequest,
  CheckWordRequest,
  WordSyncBatchEvent,
  WordSyncBatchResolvedEvent,
  WordSyncDiscardUnresolvedRequest,
  WordSyncRequeueUnresolvedRequest,
  WordSyncStatusEvent,
  WordSyncUnresolvedDiscardedEvent,
  WordSyncUnresolvedListEvent,
  WordSyncUnresolvedRequeuedEvent,
} from "@huayi/protocol";

export interface AnalyzeSelectionCommand {
  request: AnalyzeRequest;
  type: "ANALYZE_SELECTION";
}

export interface AddWordToEudicCommand {
  request: AddWordRequest;
  type: "ADD_WORD_TO_EUDIC";
}

export interface CheckWordInEudicCommand {
  request: CheckWordRequest;
  type: "CHECK_WORD_IN_EUDIC";
}

export interface CancelRequestCommand {
  requestId: string;
  type: "CANCEL_REQUEST";
}

export interface WarmupHostCommand {
  type: "WARMUP_HOST";
}

export type ContentCommand =
  | AnalyzeSelectionCommand
  | AddWordToEudicCommand
  | CheckWordInEudicCommand
  | CancelRequestCommand
  | WarmupHostCommand;

export interface ShanbayPageReadyCommand {
  type: "SHANBAY_PAGE_READY";
}

export interface ResolveShanbayBatchCommand {
  batchId: string;
  rejectedTargets: string[];
  type: "RESOLVE_SHANBAY_BATCH";
}

export interface ListShanbayUnresolvedCommand {
  offset: number;
  type: "LIST_SHANBAY_UNRESOLVED";
}

export interface RequeueShanbayUnresolvedCommand {
  items: WordSyncRequeueUnresolvedRequest["items"];
  type: "REQUEUE_SHANBAY_UNRESOLVED";
}

export interface DiscardShanbayUnresolvedCommand {
  sourceWords: WordSyncDiscardUnresolvedRequest["sourceWords"];
  type: "DISCARD_SHANBAY_UNRESOLVED";
}

export interface DiscardAllShanbayUnresolvedCommand {
  type: "DISCARD_ALL_SHANBAY_UNRESOLVED";
}

export type ShanbayCommand =
  | ShanbayPageReadyCommand
  | ResolveShanbayBatchCommand
  | ListShanbayUnresolvedCommand
  | RequeueShanbayUnresolvedCommand
  | DiscardShanbayUnresolvedCommand
  | DiscardAllShanbayUnresolvedCommand;

export type ShanbayBackgroundMessage =
  | { event: WordSyncBatchEvent; type: "SHANBAY_SYNC_BATCH" }
  | { event: WordSyncBatchResolvedEvent; type: "SHANBAY_SYNC_RESOLVED" }
  | { event: WordSyncStatusEvent; type: "SHANBAY_SYNC_STATUS" }
  | { event: WordSyncUnresolvedListEvent; type: "SHANBAY_SYNC_UNRESOLVED" }
  | { event: WordSyncUnresolvedRequeuedEvent; type: "SHANBAY_SYNC_REQUEUED" }
  | { event: WordSyncUnresolvedDiscardedEvent; type: "SHANBAY_SYNC_DISCARDED" }
  | { error: AnalysisError; type: "SHANBAY_SYNC_ERROR" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: string[]): boolean {
  const actualKeys = Object.keys(value).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.sort().every((key, index) => actualKeys[index] === key)
  );
}

export function parseContentCommand(value: unknown): ContentCommand | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  if (value.type === "WARMUP_HOST" && hasExactKeys(value, ["type"])) {
    return { type: "WARMUP_HOST" };
  }

  if (value.type === "ANALYZE_SELECTION" && hasExactKeys(value, ["request", "type"])) {
    const parsed = analyzeRequestSchema.safeParse(value.request);
    return parsed.success ? { request: parsed.data, type: "ANALYZE_SELECTION" } : null;
  }

  if (value.type === "ADD_WORD_TO_EUDIC" && hasExactKeys(value, ["request", "type"])) {
    const parsed = addWordRequestSchema.safeParse(value.request);
    return parsed.success ? { request: parsed.data, type: "ADD_WORD_TO_EUDIC" } : null;
  }

  if (value.type === "CHECK_WORD_IN_EUDIC" && hasExactKeys(value, ["request", "type"])) {
    const parsed = checkWordRequestSchema.safeParse(value.request);
    return parsed.success ? { request: parsed.data, type: "CHECK_WORD_IN_EUDIC" } : null;
  }

  if (value.type === "CANCEL_REQUEST" && hasExactKeys(value, ["requestId", "type"])) {
    const parsed = requestIdSchema.safeParse(value.requestId);
    return parsed.success ? { requestId: parsed.data, type: "CANCEL_REQUEST" } : null;
  }

  return null;
}

export function parseShanbayCommand(value: unknown): ShanbayCommand | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "SHANBAY_PAGE_READY" && hasExactKeys(value, ["type"])) {
    return { type: "SHANBAY_PAGE_READY" };
  }
  if (
    value.type === "RESOLVE_SHANBAY_BATCH" &&
    hasExactKeys(value, ["batchId", "rejectedTargets", "type"])
  ) {
    const parsed = wordSyncResolveBatchRequestSchema.safeParse({
      batchId: value.batchId,
      rejectedTargets: value.rejectedTargets,
      requestId: "content",
      schemaVersion: SCHEMA_VERSION,
      type: "word-sync-resolve-batch",
    });
    return parsed.success
      ? {
          batchId: parsed.data.batchId,
          rejectedTargets: parsed.data.rejectedTargets,
          type: "RESOLVE_SHANBAY_BATCH",
        }
      : null;
  }
  if (value.type === "LIST_SHANBAY_UNRESOLVED" && hasExactKeys(value, ["offset", "type"])) {
    const parsed = wordSyncListUnresolvedRequestSchema.safeParse({
      limit: 100,
      offset: value.offset,
      requestId: "content",
      schemaVersion: SCHEMA_VERSION,
      type: "word-sync-list-unresolved",
    });
    return parsed.success ? { offset: parsed.data.offset, type: "LIST_SHANBAY_UNRESOLVED" } : null;
  }
  if (value.type === "REQUEUE_SHANBAY_UNRESOLVED" && hasExactKeys(value, ["items", "type"])) {
    const parsed = wordSyncRequeueUnresolvedRequestSchema.safeParse({
      items: value.items,
      requestId: "content",
      schemaVersion: SCHEMA_VERSION,
      type: "word-sync-requeue-unresolved",
    });
    return parsed.success ? { items: parsed.data.items, type: "REQUEUE_SHANBAY_UNRESOLVED" } : null;
  }
  if (value.type === "DISCARD_SHANBAY_UNRESOLVED" && hasExactKeys(value, ["sourceWords", "type"])) {
    const parsed = wordSyncDiscardUnresolvedRequestSchema.safeParse({
      requestId: "content",
      schemaVersion: SCHEMA_VERSION,
      sourceWords: value.sourceWords,
      type: "word-sync-discard-unresolved",
    });
    return parsed.success
      ? {
          sourceWords: parsed.data.sourceWords,
          type: "DISCARD_SHANBAY_UNRESOLVED",
        }
      : null;
  }
  if (value.type === "DISCARD_ALL_SHANBAY_UNRESOLVED" && hasExactKeys(value, ["type"])) {
    const parsed = wordSyncDiscardAllUnresolvedRequestSchema.safeParse({
      confirm: true,
      requestId: "content",
      schemaVersion: SCHEMA_VERSION,
      type: "word-sync-discard-all-unresolved",
    });
    return parsed.success ? { type: "DISCARD_ALL_SHANBAY_UNRESOLVED" } : null;
  }
  return null;
}
