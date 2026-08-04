import {
  WORD_SYNC_DATA_SOURCE_VERSION,
  wordSyncStateSchema,
  wordSyncStateV2Schema,
  type LegacyWordSyncState,
  type PersistedWordSyncState,
  type WordSyncState,
  type WordSyncStateV2,
} from "./word-sync-state-schema.js";

function migrateVersion1ToVersion2(state: LegacyWordSyncState): WordSyncStateV2 {
  return wordSyncStateV2Schema.parse({
    activeBatch:
      state.activeBatch === null
        ? null
        : { batchId: state.activeBatch.batchId, sourceKeys: state.activeBatch.keys },
    deliveredTargetKeys: [],
    historyComplete: state.historyComplete,
    lastErrorCode: state.lastErrorCode,
    lastPollSucceeded: state.lastPollSucceeded,
    lastSuccessfulPollAt: state.lastSuccessfulPollAt,
    legacyReauditProbe: null,
    pending: state.pending.map((entry) => ({
      attempt: "original",
      attemptedTargetKeys: [entry.key],
      sourceKey: entry.key,
      sourceWord: entry.word,
      targetKey: entry.key,
      targetWord: entry.word,
    })),
    resolved: state.completedKeys.map((key) => ({
      outcome: "legacy-completed",
      sourceKey: key,
      sourceWord: key,
      targetKey: null,
      targetWord: null,
    })),
    scan: state.scan,
    skippedCount: state.skippedCount,
    skippedKeys: state.skippedKeys,
    stateVersion: 2,
    unresolved: [],
  });
}

function migrateVersion2ToVersion3(state: WordSyncStateV2): WordSyncState {
  return wordSyncStateSchema.parse({
    ...state,
    dataSourceVersion: WORD_SYNC_DATA_SOURCE_VERSION,
    lastErrorCode: null,
    lastPollSucceeded: true,
    lastSuccessfulPollAt: null,
    scan: null,
    stateVersion: 3,
  });
}

export function migrateWordSyncState(state: PersistedWordSyncState): WordSyncState {
  if (state.stateVersion === 3) return state;
  const version2 = state.stateVersion === 2 ? state : migrateVersion1ToVersion2(state);
  return migrateVersion2ToVersion3(version2);
}
