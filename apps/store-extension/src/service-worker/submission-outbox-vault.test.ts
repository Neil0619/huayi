import { describe, expect, it } from "vitest";

import type { DeviceVault } from "@huayi/store-domain";

import {
  createSubmissionOutboxVault,
  type SubmissionOutboxVaultStorage,
} from "./submission-outbox-vault.js";

class MemoryStorage implements SubmissionOutboxVaultStorage {
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
  getDek: async () => new Uint8Array(32).fill(11),
} as Pick<DeviceVault, "getDek">;

describe("SW-only SubmissionOutboxVault", () => {
  it("encrypts only strict StudyCapture and CloudWordCopy intents under one fixed envelope", async () => {
    const storage = new MemoryStorage();
    const vault = createSubmissionOutboxVault({ crypto: globalThis.crypto, deviceVault, storage });
    const state = {
      clientUpgradeRequiredAtVersion: "1.0.0",
      items: [
        {
          createdAt: "2026-08-13T00:00:00.000Z",
          idempotencyKey: "submission-1",
          input: {
            payload: { kind: "sentence" as const, sourceText: "This remains encrypted." },
            type: "study-capture" as const,
          },
        },
        {
          createdAt: "2026-08-13T00:00:01.000Z",
          idempotencyKey: "submission-2",
          input: {
            payload: {
              collectedAt: "2026-08-13T00:00:00.000Z",
              contextualMeaningZh: "维持",
              headword: "sustain",
              sentence: "The effort cannot be sustained.",
            },
            type: "cloud-word-copy" as const,
          },
        },
      ],
    };

    await vault.write(state);
    expect(JSON.stringify([...storage.values])).not.toContain("This remains encrypted.");
    expect(JSON.stringify([...storage.values])).not.toContain("sustain");
    expect(JSON.stringify([...storage.values])).toContain("huayi-store-learning-outbox");
    await expect(vault.read()).resolves.toEqual(state);

    const originalState = { items: state.items };
    await vault.write(originalState);
    await expect(vault.read()).resolves.toEqual(originalState);
  });

  it("deletes legacy full-result envelopes without decrypting or uploading them", async () => {
    const storage = new MemoryStorage();
    await storage.write("huayi.store.cloud.submission-outbox", {
      algorithm: "AES-256-GCM",
      ciphertext: "x".repeat(24),
      iv: "x".repeat(16),
      kind: "huayi-store-submission-outbox",
      version: 1,
    });
    const vault = createSubmissionOutboxVault({ crypto: globalThis.crypto, deviceVault, storage });

    await expect(vault.read()).resolves.toEqual({ items: [] });
    expect(storage.values.size).toBe(0);
  });

  it("deletes the unpublished StudyCapture-only v2 envelope instead of guessing its payload", async () => {
    const storage = new MemoryStorage();
    await storage.write("huayi.store.cloud.submission-outbox", {
      algorithm: "AES-256-GCM",
      ciphertext: "x".repeat(24),
      iv: "x".repeat(16),
      kind: "huayi-store-study-capture-outbox",
      version: 2,
    });
    const vault = createSubmissionOutboxVault({ crypto: globalThis.crypto, deviceVault, storage });

    await expect(vault.read()).resolves.toEqual({ items: [] });
    expect(storage.values.size).toBe(0);
  });
});
