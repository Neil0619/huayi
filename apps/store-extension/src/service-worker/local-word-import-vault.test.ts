import { describe, expect, it } from "vitest";

import type { DeviceVault } from "@huayi/store-domain";

import {
  createLocalWordImportVault,
  type LocalWordImportVaultStorage,
} from "./local-word-import-vault.js";

class MemoryStorage implements LocalWordImportVaultStorage {
  readonly values = new Map<string, unknown>();
  async delete(key: string) {
    this.values.delete(key);
  }
  async read(key: string) {
    return this.values.get(key);
  }
  async write(key: string, value: unknown) {
    this.values.set(key, structuredClone(value));
  }
}

const deviceVault = {
  getDek: async () => new Uint8Array(32).fill(17),
} as Pick<DeviceVault, "getDek">;

describe("SW-only LocalWordImportVault", () => {
  it("encrypts the confirmed snapshot, progress, and stable batch keys", async () => {
    const storage = new MemoryStorage();
    const vault = createLocalWordImportVault({ crypto: globalThis.crypto, deviceVault, storage });
    const job = {
      batches: [
        {
          idempotencyKey: "local-import-batch-1",
          request: {
            entries: [
              {
                contexts: [],
                entryKey: "acquire",
                headword: "acquire",
              },
            ],
          },
        },
      ],
      nextBatchIndex: 0,
      status: "pending" as const,
      summary: {
        contextCount: 0,
        createdContextCount: 0,
        createdWordCount: 0,
        duplicateContextCount: 0,
        existingWordCount: 0,
        wordCount: 0,
      },
    };

    await vault.write(job);
    expect(JSON.stringify([...storage.values])).not.toContain("acquire");
    expect(JSON.stringify([...storage.values])).toContain("huayi-store-local-word-import");
    await expect(vault.read()).resolves.toEqual(job);
    await vault.clear();
    await expect(vault.read()).resolves.toBeNull();
  });
});
