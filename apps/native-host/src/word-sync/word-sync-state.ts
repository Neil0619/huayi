import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

import { eudicError } from "../wordbook/eudic-errors.js";
import {
  createInitialWordSyncState,
  persistedWordSyncStateSchema,
  wordSyncStateSchema,
  type PersistedWordSyncState,
  type WordSyncState,
} from "./word-sync-state-schema.js";
import { migrateWordSyncState } from "./word-sync-state-migration.js";

const MAXIMUM_STATE_BYTES = 16 * 1024 * 1024;

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function assertSafeExistingFile(path: string): Promise<void> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw eudicError("WORD_SYNC_STATE_INVALID");
  }
  if (process.platform !== "win32" && typeof process.getuid === "function") {
    if (stats.uid !== process.getuid() || (stats.mode & 0o077) !== 0) {
      throw eudicError("WORD_SYNC_STATE_INVALID");
    }
  }
}

async function readStateFile(path: string): Promise<PersistedWordSyncState | null> {
  await assertSafeExistingFile(path);
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  if (bytes.byteLength > MAXIMUM_STATE_BYTES) {
    throw eudicError("WORD_SYNC_STATE_INVALID");
  }
  try {
    return persistedWordSyncStateSchema.parse(JSON.parse(bytes.toString("utf8")) as unknown);
  } catch (error) {
    throw eudicError("WORD_SYNC_STATE_INVALID", error);
  }
}

async function syncDirectory(path: string): Promise<void> {
  try {
    const directory = await open(path, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
}

async function writeAtomic(path: string, contents: string): Promise<void> {
  const directoryPath = dirname(path);
  await mkdir(directoryPath, { mode: 0o700, recursive: true });
  await assertSafeExistingFile(path);
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let temporaryCreated = false;
  let renamed = false;
  try {
    const file = await open(temporaryPath, "wx", 0o600);
    temporaryCreated = true;
    try {
      await file.writeFile(contents, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporaryPath, path);
    renamed = true;
    await syncDirectory(directoryPath);
  } finally {
    if (temporaryCreated && !renamed) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

export interface WordSyncStateStoreOptions {
  path: string;
}

export interface LoadWordSyncStateOptions {
  readonly persistMigration?: boolean;
}

export class WordSyncStateStore {
  readonly backupPath: string;
  readonly legacySnapshotPath: string;
  readonly path: string;
  /** Restore this immutable snapshot together with a v2 Host when rolling back the upgrade. */
  readonly version2SnapshotPath: string;

  constructor(options: WordSyncStateStoreOptions) {
    this.path = options.path;
    this.backupPath = `${options.path}.backup`;
    this.legacySnapshotPath = `${options.path}.v1-snapshot`;
    this.version2SnapshotPath = `${options.path}.v2-snapshot`;
  }

  async load(options: LoadWordSyncStateOptions = {}): Promise<WordSyncState> {
    const persistMigration = options.persistMigration ?? true;
    try {
      const persisted = await readStateFile(this.path);
      if (persisted !== null) {
        const state = migrateWordSyncState(persisted);
        if (persistMigration && persisted.stateVersion === 1) {
          await this.writeLegacySnapshot(persisted);
          await writeAtomic(this.backupPath, `${JSON.stringify(persisted)}\n`);
          await writeAtomic(this.path, `${JSON.stringify(state)}\n`);
        } else if (persistMigration && persisted.stateVersion === 2) {
          await this.writeVersion2Snapshot(persisted);
          await writeAtomic(this.backupPath, `${JSON.stringify(persisted)}\n`);
          await writeAtomic(this.path, `${JSON.stringify(state)}\n`);
        }
        return state;
      }
    } catch (primaryError) {
      try {
        const backup = await readStateFile(this.backupPath);
        if (backup === null) throw primaryError;
        const state = migrateWordSyncState(backup);
        if (persistMigration) {
          if (backup.stateVersion === 1) await this.writeLegacySnapshot(backup);
          if (backup.stateVersion === 2) await this.writeVersion2Snapshot(backup);
          await writeAtomic(this.path, `${JSON.stringify(state)}\n`);
        }
        return state;
      } catch {
        throw primaryError;
      }
    }

    const persistedBackup = await readStateFile(this.backupPath);
    if (persistedBackup !== null) {
      const state = migrateWordSyncState(persistedBackup);
      if (persistMigration) {
        if (persistedBackup.stateVersion === 1) {
          await this.writeLegacySnapshot(persistedBackup);
        }
        if (persistedBackup.stateVersion === 2) {
          await this.writeVersion2Snapshot(persistedBackup);
        }
        await writeAtomic(this.path, `${JSON.stringify(state)}\n`);
      }
      return state;
    }
    return createInitialWordSyncState();
  }

  async save(value: WordSyncState): Promise<void> {
    const state = wordSyncStateSchema.parse(value);
    const existing = await readStateFile(this.path);
    if (existing !== null) {
      await writeAtomic(this.backupPath, `${JSON.stringify(existing)}\n`);
    }
    await writeAtomic(this.path, `${JSON.stringify(state)}\n`);
  }

  private async writeLegacySnapshot(state: PersistedWordSyncState): Promise<void> {
    if (state.stateVersion !== 1) return;
    const existing = await readStateFile(this.legacySnapshotPath);
    if (existing !== null) {
      if (existing.stateVersion !== 1) throw eudicError("WORD_SYNC_STATE_INVALID");
      return;
    }
    await writeAtomic(this.legacySnapshotPath, `${JSON.stringify(state)}\n`);
  }

  private async writeVersion2Snapshot(state: PersistedWordSyncState): Promise<void> {
    if (state.stateVersion !== 2) return;
    const existing = await readStateFile(this.version2SnapshotPath);
    if (existing !== null) {
      if (existing.stateVersion !== 2) throw eudicError("WORD_SYNC_STATE_INVALID");
      return;
    }
    await writeAtomic(this.version2SnapshotPath, `${JSON.stringify(state)}\n`);
  }
}

export {
  createInitialWordSyncState,
  legacyWordSyncStateSchema,
  wordSyncStateSchema,
} from "./word-sync-state-schema.js";
export { migrateWordSyncState } from "./word-sync-state-migration.js";
export type {
  LegacyWordSyncState,
  WordSyncState,
  WordSyncStateV2,
} from "./word-sync-state-schema.js";
