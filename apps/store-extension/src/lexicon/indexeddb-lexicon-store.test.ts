import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { wordEntrySchema } from "@huayi/store-domain";

import { createIndexedDbLexiconStore } from "./indexeddb-lexicon-store.js";
import { createLexiconCryptoContext } from "./lexicon-crypto.js";

const RECORD_STORE = "encrypted-records";
const DEK = new Uint8Array(32).fill(42);

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => undefined;
  });
}

async function createVersionOneDatabase(
  factory: IDBFactory,
  databaseName: string,
  value?: unknown,
): Promise<void> {
  const request = factory.open(databaseName, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(RECORD_STORE, { keyPath: "opaqueId" });
  };
  const database = await requestResult(request);
  if (value !== undefined) {
    const transaction = database.transaction(RECORD_STORE, "readwrite");
    const done = transactionDone(transaction);
    await requestResult(transaction.objectStore(RECORD_STORE).add(value));
    await done;
  }
  database.close();
}

async function encryptedRecord(headword: string, revision = 1) {
  const cryptoContext = await createLexiconCryptoContext(globalThis.crypto, DEK);
  const entry = wordEntrySchema.parse({
    contexts: [],
    createdAt: "2026-08-11T00:00:00.000Z",
    headword,
    id: headword,
    updatedAt: "2026-08-11T00:00:00.000Z",
  });
  const opaqueId = await cryptoContext.opaqueId(headword);
  return cryptoContext.encryptRecord(entry, opaqueId, revision);
}

describe("IndexedDbLexiconStore", () => {
  it("migrates a valid v1 encrypted store and initializes concurrency metadata", async () => {
    const factory = new IDBFactory();
    const databaseName = `lexicon-migrate-${crypto.randomUUID()}`;
    const record = await encryptedRecord("migrated");
    await createVersionOneDatabase(factory, databaseName, record);

    const store = createIndexedDbLexiconStore({ databaseName, indexedDB: factory });
    await expect(store.readAll()).resolves.toEqual({ generation: 0, records: [record] });
  });

  it("aborts migration without overwriting corrupt v1 data", async () => {
    const factory = new IDBFactory();
    const databaseName = `lexicon-corrupt-${crypto.randomUUID()}`;
    const corrupt = { headword: "plaintext-must-survive", opaqueId: "not-opaque" };
    await createVersionOneDatabase(factory, databaseName, corrupt);

    const store = createIndexedDbLexiconStore({ databaseName, indexedDB: factory });
    await expect(store.readAll()).rejects.toMatchObject({ code: "data-corrupt" });

    const database = await requestResult(factory.open(databaseName, 1));
    const transaction = database.transaction(RECORD_STORE, "readonly");
    const done = transactionDone(transaction);
    await expect(requestResult(transaction.objectStore(RECORD_STORE).getAll())).resolves.toEqual([
      corrupt,
    ]);
    await done;
    database.close();
  });

  it("fails closed when the database was created by an unknown newer schema", async () => {
    const factory = new IDBFactory();
    const databaseName = `lexicon-newer-${crypto.randomUUID()}`;
    const database = await requestResult(factory.open(databaseName, 3));
    database.close();

    const store = createIndexedDbLexiconStore({ databaseName, indexedDB: factory });
    await expect(store.readAll()).rejects.toMatchObject({ code: "incompatible-schema" });
  });
});
