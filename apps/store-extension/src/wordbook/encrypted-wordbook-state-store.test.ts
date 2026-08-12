import { indexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { createEncryptedWordbookStateStore } from "./encrypted-wordbook-state-store.js";

const dek = new Uint8Array(32).fill(17);

function readRaw(databaseName: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction("state", "readonly");
      const get = transaction.objectStore("state").get("wordbook");
      get.onerror = () => reject(get.error);
      get.onsuccess = () => resolve(get.result as Record<string, unknown>);
    };
  });
}

function writeRaw(databaseName: string, value: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction("state", "readwrite");
      transaction.objectStore("state").put(value);
      transaction.onabort = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();
    };
  });
}

describe("encrypted durable wordbook state", () => {
  it("persists one CAS snapshot without plaintext headwords or contexts", async () => {
    const databaseName = `huayi-wordbook-${crypto.randomUUID()}`;
    const store = createEncryptedWordbookStateStore({
      crypto,
      databaseName,
      dekSource: { read: async () => dek },
      indexedDB,
    });
    const initial = await store.read();
    expect(initial.revision).toBe(0);
    const state = {
      importJob: {
        duplicateCount: 0,
        importedCount: 0,
        nextPage: 0,
        state: "idle" as const,
        updatedAt: "2026-08-11T00:00:00.000Z",
      },
      importSeenEntryIds: [],
      outbox: [
        {
          attemptCount: 0,
          createdAt: "2026-08-11T00:00:00.000Z",
          entryId: "investigation",
          id: "outbox-1",
          state: "queued" as const,
          target: "eudic" as const,
          updatedAt: "2026-08-11T00:00:00.000Z",
        },
      ],
      schemaVersion: 1 as const,
    };
    await expect(store.compareAndSwap(0, state)).resolves.toBe(true);
    await expect(store.compareAndSwap(0, state)).resolves.toBe(false);
    await expect(store.read()).resolves.toMatchObject({ revision: 1, state });

    const raw = await readRaw(databaseName);
    const serialized = JSON.stringify(raw);
    expect(serialized).not.toContain("investigation");
    expect(serialized).not.toContain("The investigation began");
  });

  it("fails closed when ciphertext is tampered", async () => {
    const databaseName = `huayi-wordbook-${crypto.randomUUID()}`;
    const store = createEncryptedWordbookStateStore({
      crypto,
      databaseName,
      dekSource: { read: async () => dek },
      indexedDB,
    });
    const initial = await store.read();
    await store.compareAndSwap(initial.revision, initial.state);
    const raw = await readRaw(databaseName);
    await writeRaw(databaseName, { ...raw, ciphertext: "AAAA" });

    await expect(store.read()).rejects.toMatchObject({ code: "data-corrupt" });
  });
});
