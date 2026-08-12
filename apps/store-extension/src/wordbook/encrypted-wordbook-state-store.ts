import type { DeviceDekSource } from "../lexicon/device-dek-source.js";
import {
  createInitialWordbookState,
  wordbookPersistentStateSchema,
  type WordbookPersistentState,
  type WordbookStateStore,
} from "./wordbook-state.js";

const DATABASE_VERSION = 1;
const RECORD_ID = "wordbook";
const STATE_STORE_NAME = "state";
const textEncoder = new TextEncoder();

interface EncryptedStateRecord {
  readonly ciphertext: string;
  readonly id: typeof RECORD_ID;
  readonly iv: string;
  readonly revision: number;
  readonly schemaVersion: 1;
}

interface EncryptedWordbookStateStoreOptions {
  readonly crypto: Crypto;
  readonly databaseName: string;
  readonly dekSource: DeviceDekSource;
  readonly indexedDB: IDBFactory;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function buffer(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer;
}

function base64ToBytes(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error("Wordbook encrypted state is invalid.");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function aad(revision: number): Uint8Array {
  return textEncoder.encode(`huayi-store\u0000wordbook-state\u00001\u0000${revision}`);
}

function isEncryptedRecord(value: unknown): value is EncryptedStateRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).sort().join("|") === "ciphertext|id|iv|revision|schemaVersion" &&
    record.id === RECORD_ID &&
    record.schemaVersion === 1 &&
    typeof record.ciphertext === "string" &&
    typeof record.iv === "string" &&
    Number.isSafeInteger(record.revision) &&
    Number(record.revision) > 0
  );
}

function openDatabase(options: EncryptedWordbookStateStoreOptions): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = options.indexedDB.open(options.databaseName, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Wordbook database open failed."));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STATE_STORE_NAME)) {
        database.createObjectStore(STATE_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function readRaw(database: IDBDatabase): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STATE_STORE_NAME, "readonly");
    const request = transaction.objectStore(STATE_STORE_NAME).get(RECORD_ID);
    request.onerror = () => reject(request.error ?? new Error("Wordbook state read failed."));
    request.onsuccess = () => resolve(request.result);
  });
}

async function deriveKey(options: EncryptedWordbookStateStoreOptions): Promise<CryptoKey> {
  const dek = await options.dekSource.read();
  const material = await options.crypto.subtle.importKey("raw", buffer(dek), "HKDF", false, [
    "deriveKey",
  ]);
  return options.crypto.subtle.deriveKey(
    {
      hash: "SHA-256",
      info: textEncoder.encode("wordbook-state-aes-256-gcm"),
      name: "HKDF",
      salt: textEncoder.encode("huayi-store-wordbook-v1"),
    },
    material,
    { length: 256, name: "AES-GCM" },
    false,
    ["decrypt", "encrypt"],
  );
}

async function decryptRecord(
  options: EncryptedWordbookStateStoreOptions,
  record: EncryptedStateRecord,
): Promise<WordbookPersistentState> {
  try {
    const plaintext = await options.crypto.subtle.decrypt(
      {
        additionalData: buffer(aad(record.revision)),
        iv: buffer(base64ToBytes(record.iv)),
        name: "AES-GCM",
      },
      await deriveKey(options),
      buffer(base64ToBytes(record.ciphertext)),
    );
    return wordbookPersistentStateSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)) as unknown,
    );
  } catch {
    throw Object.assign(new Error("Wordbook encrypted state is invalid."), {
      code: "data-corrupt",
    });
  }
}

async function encryptRecord(
  options: EncryptedWordbookStateStoreOptions,
  state: WordbookPersistentState,
  revision: number,
): Promise<EncryptedStateRecord> {
  const parsed = wordbookPersistentStateSchema.parse(state);
  const iv = options.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await options.crypto.subtle.encrypt(
    { additionalData: buffer(aad(revision)), iv: buffer(iv), name: "AES-GCM" },
    await deriveKey(options),
    textEncoder.encode(JSON.stringify(parsed)),
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    id: RECORD_ID,
    iv: bytesToBase64(iv),
    revision,
    schemaVersion: 1,
  };
}

function compareAndPut(
  database: IDBDatabase,
  expectedRevision: number,
  record: EncryptedStateRecord,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STATE_STORE_NAME, "readwrite");
    const store = transaction.objectStore(STATE_STORE_NAME);
    const request = store.get(RECORD_ID);
    let matched = false;
    request.onerror = () => transaction.abort();
    request.onsuccess = () => {
      const current = request.result;
      const currentRevision = current === undefined ? 0 : Number(current.revision);
      if (currentRevision !== expectedRevision) return;
      matched = true;
      store.put(record);
    };
    transaction.onabort = () => reject(transaction.error ?? new Error("Wordbook CAS failed."));
    transaction.onerror = () => undefined;
    transaction.oncomplete = () => resolve(matched);
  });
}

export function createEncryptedWordbookStateStore(
  options: EncryptedWordbookStateStoreOptions,
): WordbookStateStore {
  return {
    async compareAndSwap(expectedRevision, state) {
      const record = await encryptRecord(options, state, expectedRevision + 1);
      const database = await openDatabase(options);
      try {
        return await compareAndPut(database, expectedRevision, record);
      } finally {
        database.close();
      }
    },
    async read() {
      const database = await openDatabase(options);
      let raw: unknown;
      try {
        raw = await readRaw(database);
      } finally {
        database.close();
      }
      if (raw === undefined) {
        return {
          revision: 0,
          state: createInitialWordbookState("1970-01-01T00:00:00.000Z"),
        };
      }
      if (!isEncryptedRecord(raw)) {
        throw Object.assign(new Error("Wordbook encrypted state is invalid."), {
          code: "data-corrupt",
        });
      }
      return { revision: raw.revision, state: await decryptRecord(options, raw) };
    },
  };
}
