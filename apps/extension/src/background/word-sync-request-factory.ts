import {
  SCHEMA_VERSION,
  type WordSyncDiscardAllUnresolvedRequest,
  type WordSyncDiscardUnresolvedRequest,
  type WordSyncListUnresolvedRequest,
  type WordSyncPollRequest,
  type WordSyncPrepareBatchRequest,
  type WordSyncRequeueUnresolvedRequest,
  type WordSyncResolveBatchRequest,
  type WordSyncStatusRequest,
} from "@huayi/protocol";

export function createWordSyncResolveBatchRequest(
  requestId: string,
  batchId: string,
  rejectedTargets: readonly string[],
): WordSyncResolveBatchRequest {
  return {
    batchId,
    rejectedTargets: [...rejectedTargets],
    requestId,
    schemaVersion: SCHEMA_VERSION,
    type: "word-sync-resolve-batch",
  };
}

export function createWordSyncListUnresolvedRequest(
  requestId: string,
  offset: number,
): WordSyncListUnresolvedRequest {
  return {
    limit: 100,
    offset,
    requestId,
    schemaVersion: SCHEMA_VERSION,
    type: "word-sync-list-unresolved",
  };
}

export function createWordSyncRequeueUnresolvedRequest(
  requestId: string,
  items: WordSyncRequeueUnresolvedRequest["items"],
): WordSyncRequeueUnresolvedRequest {
  return {
    items,
    requestId,
    schemaVersion: SCHEMA_VERSION,
    type: "word-sync-requeue-unresolved",
  };
}

export function createWordSyncDiscardUnresolvedRequest(
  requestId: string,
  sourceWords: readonly string[],
): WordSyncDiscardUnresolvedRequest {
  return {
    requestId,
    schemaVersion: SCHEMA_VERSION,
    sourceWords: [...sourceWords],
    type: "word-sync-discard-unresolved",
  };
}

export function createWordSyncDiscardAllUnresolvedRequest(
  requestId: string,
): WordSyncDiscardAllUnresolvedRequest {
  return {
    confirm: true,
    requestId,
    schemaVersion: SCHEMA_VERSION,
    type: "word-sync-discard-all-unresolved",
  };
}

export function createWordSyncStatusRequest(requestId: string): WordSyncStatusRequest {
  return {
    requestId,
    schemaVersion: SCHEMA_VERSION,
    type: "word-sync-status",
  };
}

export function createWordSyncPollRequest(requestId: string): WordSyncPollRequest {
  return {
    requestId,
    schemaVersion: SCHEMA_VERSION,
    type: "word-sync-poll",
  };
}

export function createWordSyncPrepareBatchRequest(requestId: string): WordSyncPrepareBatchRequest {
  return {
    requestId,
    schemaVersion: SCHEMA_VERSION,
    type: "word-sync-prepare-batch",
  };
}
