import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { createBrowserLexiconRepository } from "./browser-lexicon-repository.js";
import { createIndexedDbLexiconStore } from "./indexeddb-lexicon-store.js";
import { parseEncryptedRecord, type EncryptedLexiconRecord } from "./lexicon-codec.js";

const DATABASE_VERSION = 2;
const RECORD_STORE = "encrypted-records";
const DEK = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);

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

function createFixture(): {
  readonly databaseName: string;
  readonly factory: IDBFactory;
  readonly repository: ReturnType<typeof createBrowserLexiconRepository>;
} {
  const factory = new IDBFactory();
  const databaseName = `lexicon-security-${crypto.randomUUID()}`;
  return {
    databaseName,
    factory,
    repository: createBrowserLexiconRepository({
      clock: () => new Date("2026-08-11T00:00:00.000Z"),
      crypto: globalThis.crypto,
      dekSource: { read: async () => Uint8Array.from(DEK) },
      randomId: () => crypto.randomUUID(),
      store: createIndexedDbLexiconStore({ databaseName, indexedDB: factory }),
    }),
  };
}

async function readRecords(
  factory: IDBFactory,
  databaseName: string,
): Promise<EncryptedLexiconRecord[]> {
  const database = await requestResult(factory.open(databaseName, DATABASE_VERSION));
  const transaction = database.transaction(RECORD_STORE, "readonly");
  const done = transactionDone(transaction);
  const values = await requestResult(transaction.objectStore(RECORD_STORE).getAll());
  await done;
  database.close();
  return values.map(parseEncryptedRecord);
}

async function replaceRecords(
  factory: IDBFactory,
  databaseName: string,
  records: readonly EncryptedLexiconRecord[],
): Promise<void> {
  const database = await requestResult(factory.open(databaseName, DATABASE_VERSION));
  const transaction = database.transaction(RECORD_STORE, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(RECORD_STORE);
  await requestResult(store.clear());
  for (const record of records) {
    await requestResult(store.add(record));
  }
  await done;
  database.close();
}

function flipBase64(value: string): string {
  const index = Math.floor(value.length / 2);
  const replacement = value[index] === "A" ? "B" : "A";
  return `${value.slice(0, index)}${replacement}${value.slice(index + 1)}`;
}

describe("encrypted Lexicon storage", () => {
  it("stores only opaque identities and independently encrypted records", async () => {
    const { databaseName, factory, repository } = createFixture();
    const inputWithForbiddenFields = {
      context: {
        contextualMeaningZh: "苹果公司发布了产品",
        sentence: "Apple released a product.",
        source: "web" as const,
      },
      fullModelOutput: "private complete model output",
      headword: "Apple",
      pageTitle: "A sensitive page title",
      url: "https://private.example/lesson",
    };
    await repository.save(inputWithForbiddenFields);
    await repository.save({ headword: "banana" });

    const records = await readRecords(factory, databaseName);
    expect(records).toHaveLength(2);
    expect(new Set(records.map((record) => record.iv)).size).toBe(2);
    expect(records.every((record) => /^[a-f0-9]{64}$/.test(record.opaqueId))).toBe(true);

    const database = await requestResult(factory.open(databaseName, DATABASE_VERSION));
    const metadataTransaction = database.transaction("metadata", "readonly");
    const metadataDone = transactionDone(metadataTransaction);
    const metadata = await requestResult(metadataTransaction.objectStore("metadata").getAll());
    await metadataDone;
    database.close();
    const persisted = JSON.stringify({ metadata, records });
    for (const forbidden of [
      "apple",
      "banana",
      "Apple released a product.",
      "苹果公司发布了产品",
      "private.example",
      "sensitive page title",
      "complete model output",
    ]) {
      expect(persisted.toLocaleLowerCase()).not.toContain(forbidden.toLocaleLowerCase());
    }
  });

  it("fails closed when ciphertext or AAD-bound revision is tampered", async () => {
    const { databaseName, factory, repository } = createFixture();
    await repository.save({ headword: "tamper" });
    const [original] = await readRecords(factory, databaseName);
    if (original === undefined) {
      throw new Error("Expected an encrypted record.");
    }

    await replaceRecords(factory, databaseName, [
      { ...original, ciphertext: flipBase64(original.ciphertext) },
    ]);
    await expect(repository.list({ limit: 10 })).rejects.toMatchObject({ code: "data-corrupt" });

    await replaceRecords(factory, databaseName, [{ ...original, revision: original.revision + 1 }]);
    await expect(repository.list({ limit: 10 })).rejects.toMatchObject({ code: "data-corrupt" });
  });

  it("rejects ciphertext swapped between opaque record identities", async () => {
    const { databaseName, factory, repository } = createFixture();
    await repository.save({ headword: "alpha" });
    await repository.save({ headword: "beta" });
    const records = await readRecords(factory, databaseName);
    const [first, second] = records;
    if (first === undefined || second === undefined) {
      throw new Error("Expected two encrypted records.");
    }
    await replaceRecords(factory, databaseName, [
      { ...first, ciphertext: second.ciphertext, iv: second.iv },
      { ...second, ciphertext: first.ciphertext, iv: first.iv },
    ]);

    await expect(repository.list({ limit: 10 })).rejects.toMatchObject({ code: "data-corrupt" });
    await expect(repository.save({ headword: "gamma" })).rejects.toMatchObject({
      code: "data-corrupt",
    });
  });
});
