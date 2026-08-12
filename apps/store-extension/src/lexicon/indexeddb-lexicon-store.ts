import { parseEncryptedRecord, type EncryptedLexiconRecord } from "./lexicon-codec.js";
import { LexiconError } from "./lexicon-error.js";

const DATABASE_VERSION = 2;
const RECORD_STORE = "encrypted-records";
const METADATA_STORE = "metadata";
const METADATA_KEY = "state";

export interface LexiconRecordSnapshot {
  readonly generation: number;
  readonly records: readonly EncryptedLexiconRecord[];
}

export interface LexiconRecordStore {
  compareAndSwap(
    record: EncryptedLexiconRecord,
    expectedRevision: number | null,
    expectedGeneration: number,
  ): Promise<boolean>;
  deleteIfRevision(
    opaqueId: string,
    expectedRevision: number,
    expectedGeneration: number,
  ): Promise<boolean>;
  read(opaqueId: string): Promise<EncryptedLexiconRecord | null>;
  readAll(): Promise<LexiconRecordSnapshot>;
}

interface IndexedDbLexiconStoreOptions {
  readonly databaseName: string;
  readonly indexedDB: IDBFactory;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new LexiconError("storage-failure"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new LexiconError("storage-failure"));
    transaction.onerror = () => undefined;
  });
}

function abortQuietly(transaction: IDBTransaction): void {
  try {
    transaction.abort();
  } catch {
    // The transaction may already have aborted because of the failing request.
  }
}

function mapStorageError(error: unknown): LexiconError {
  if (error instanceof LexiconError) {
    return error;
  }
  if (error instanceof DOMException && error.name === "VersionError") {
    return new LexiconError("incompatible-schema");
  }
  return new LexiconError("storage-failure");
}

function parseGeneration(value: unknown): number {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 3 ||
    !("key" in value) ||
    value.key !== METADATA_KEY ||
    !("generation" in value) ||
    !Number.isSafeInteger(value.generation) ||
    (value.generation as number) < 0 ||
    !("version" in value) ||
    value.version !== 1
  ) {
    throw new LexiconError("data-corrupt");
  }
  return value.generation as number;
}

function generationRecord(generation: number): object {
  return { generation, key: METADATA_KEY, version: 1 };
}

function nextGeneration(generation: number): number {
  if (generation >= Number.MAX_SAFE_INTEGER) {
    throw new LexiconError("data-corrupt");
  }
  return generation + 1;
}

class IndexedDbLexiconStore implements LexiconRecordStore {
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: IDBFactory,
    private readonly databaseName: string,
  ) {}

  async read(opaqueId: string): Promise<EncryptedLexiconRecord | null> {
    const database = await this.getDatabase();
    const transaction = database.transaction(RECORD_STORE, "readonly");
    const done = transactionDone(transaction);
    try {
      const raw = await requestResult(transaction.objectStore(RECORD_STORE).get(opaqueId));
      await done;
      return raw === undefined ? null : parseEncryptedRecord(raw);
    } catch (error) {
      await done.catch(() => undefined);
      throw mapStorageError(error);
    }
  }

  async readAll(): Promise<LexiconRecordSnapshot> {
    const database = await this.getDatabase();
    const transaction = database.transaction([RECORD_STORE, METADATA_STORE], "readonly");
    const done = transactionDone(transaction);
    try {
      const [raw, rawMetadata] = await Promise.all([
        requestResult(transaction.objectStore(RECORD_STORE).getAll()),
        requestResult(transaction.objectStore(METADATA_STORE).get(METADATA_KEY)),
      ]);
      await done;
      return {
        generation: parseGeneration(rawMetadata),
        records: raw.map(parseEncryptedRecord),
      };
    } catch (error) {
      await done.catch(() => undefined);
      throw mapStorageError(error);
    }
  }

  async compareAndSwap(
    record: EncryptedLexiconRecord,
    expectedRevision: number | null,
    expectedGeneration: number,
  ): Promise<boolean> {
    const parsedRecord = parseEncryptedRecord(record);
    const database = await this.getDatabase();
    const transaction = database.transaction([RECORD_STORE, METADATA_STORE], "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(RECORD_STORE);
    const metadataStore = transaction.objectStore(METADATA_STORE);
    try {
      const [rawCurrent, rawMetadata] = await Promise.all([
        requestResult(store.get(parsedRecord.opaqueId)),
        requestResult(metadataStore.get(METADATA_KEY)),
      ]);
      const current = rawCurrent === undefined ? null : parseEncryptedRecord(rawCurrent);
      const generation = parseGeneration(rawMetadata);
      if ((current?.revision ?? null) !== expectedRevision || generation !== expectedGeneration) {
        await done;
        return false;
      }
      await requestResult(store.put(parsedRecord));
      await requestResult(metadataStore.put(generationRecord(nextGeneration(generation))));
      await done;
      return true;
    } catch (error) {
      abortQuietly(transaction);
      await done.catch(() => undefined);
      throw mapStorageError(error);
    }
  }

  async deleteIfRevision(
    opaqueId: string,
    expectedRevision: number,
    expectedGeneration: number,
  ): Promise<boolean> {
    const database = await this.getDatabase();
    const transaction = database.transaction([RECORD_STORE, METADATA_STORE], "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(RECORD_STORE);
    const metadataStore = transaction.objectStore(METADATA_STORE);
    try {
      const [rawCurrent, rawMetadata] = await Promise.all([
        requestResult(store.get(opaqueId)),
        requestResult(metadataStore.get(METADATA_KEY)),
      ]);
      const current = rawCurrent === undefined ? null : parseEncryptedRecord(rawCurrent);
      const generation = parseGeneration(rawMetadata);
      if (current?.revision !== expectedRevision || generation !== expectedGeneration) {
        await done;
        return false;
      }
      await requestResult(store.delete(opaqueId));
      await requestResult(metadataStore.put(generationRecord(nextGeneration(generation))));
      await done;
      return true;
    } catch (error) {
      abortQuietly(transaction);
      await done.catch(() => undefined);
      throw mapStorageError(error);
    }
  }

  private getDatabase(): Promise<IDBDatabase> {
    this.databasePromise ??= this.openDatabase();
    return this.databasePromise;
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.factory.open(this.databaseName, DATABASE_VERSION);
      let upgradeError: LexiconError | null = null;
      let settled = false;
      const fail = (error: LexiconError): void => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };
      request.onupgradeneeded = (event) => {
        const database = request.result;
        const transaction = request.transaction;
        if (transaction === null) {
          upgradeError = new LexiconError("storage-failure");
          return;
        }
        const oldVersion = event.oldVersion;
        if (oldVersion === 0) {
          database.createObjectStore(RECORD_STORE, { keyPath: "opaqueId" });
          const metadata = database.createObjectStore(METADATA_STORE, { keyPath: "key" });
          metadata.add(generationRecord(0));
          return;
        }
        if (
          oldVersion !== 1 ||
          !database.objectStoreNames.contains(RECORD_STORE) ||
          database.objectStoreNames.contains(METADATA_STORE)
        ) {
          upgradeError = new LexiconError("incompatible-schema");
          abortQuietly(transaction);
          return;
        }
        const metadata = database.createObjectStore(METADATA_STORE, { keyPath: "key" });
        metadata.add(generationRecord(0));
        const cursorRequest = transaction.objectStore(RECORD_STORE).openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (cursor === null) {
            return;
          }
          try {
            parseEncryptedRecord(cursor.value);
            cursor.continue();
          } catch {
            upgradeError = new LexiconError("data-corrupt");
            abortQuietly(transaction);
          }
        };
        cursorRequest.onerror = () => {
          upgradeError = new LexiconError("storage-failure");
          abortQuietly(transaction);
        };
      };
      request.onsuccess = () => {
        const database = request.result;
        if (settled) {
          database.close();
          return;
        }
        settled = true;
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () => fail(upgradeError ?? mapStorageError(request.error));
      request.onblocked = () => fail(new LexiconError("storage-failure"));
    });
  }
}

export function createIndexedDbLexiconStore(
  options: IndexedDbLexiconStoreOptions,
): LexiconRecordStore {
  return new IndexedDbLexiconStore(options.indexedDB, options.databaseName);
}
