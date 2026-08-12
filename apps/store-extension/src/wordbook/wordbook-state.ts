import {
  eudicImportJobSchema,
  exportOutboxItemSchema,
  type EudicImportJob,
  type ExportOutboxItem,
} from "@huayi/store-domain";
import { z } from "zod/v3";

const timestampSchema = z.string().datetime({ offset: true });

export const wordbookLeaseSchema = z.strictObject({
  expiresAt: timestampSchema,
  token: z.string().min(1).max(200),
});
export type WordbookLease = z.infer<typeof wordbookLeaseSchema>;

export const storedOutboxItemSchema = exportOutboxItemSchema.extend({
  lease: wordbookLeaseSchema.optional(),
});
export type StoredOutboxItem = z.infer<typeof storedOutboxItemSchema>;

export const wordbookPersistentStateSchema = z.strictObject({
  importJob: eudicImportJobSchema,
  importLease: wordbookLeaseSchema.optional(),
  importSeenEntryIds: z.array(z.string().trim().min(1).max(200)).max(10_000),
  outbox: z.array(storedOutboxItemSchema).max(20_000),
  schemaVersion: z.literal(1),
});
export type WordbookPersistentState = z.infer<typeof wordbookPersistentStateSchema>;

export interface VersionedWordbookState {
  readonly revision: number;
  readonly state: WordbookPersistentState;
}

export interface WordbookStateStore {
  read(): Promise<VersionedWordbookState>;
  compareAndSwap(expectedRevision: number, state: WordbookPersistentState): Promise<boolean>;
}

export function createInitialWordbookState(now: string): WordbookPersistentState {
  const importJob: EudicImportJob = {
    duplicateCount: 0,
    importedCount: 0,
    nextPage: 0,
    state: "idle",
    updatedAt: now,
  };
  return {
    importJob,
    importSeenEntryIds: [],
    outbox: [],
    schemaVersion: 1,
  };
}

export function publicOutboxItem(item: StoredOutboxItem): ExportOutboxItem {
  const publicItem = { ...item };
  delete publicItem.lease;
  return exportOutboxItemSchema.parse(publicItem);
}
