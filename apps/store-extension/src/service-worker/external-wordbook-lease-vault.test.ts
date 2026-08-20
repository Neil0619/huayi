import { describe, expect, it } from "vitest";

import { createExternalWordbookLeaseVault } from "./external-wordbook-lease-vault.js";

describe("SW-only external wordbook lease vault", () => {
  it("encrypts cloud IDs and tokens under a distinct envelope", async () => {
    const values = new Map<string, unknown>();
    const vault = createExternalWordbookLeaseVault({
      crypto: globalThis.crypto,
      deviceVault: { getDek: async () => new Uint8Array(32).fill(17) },
      storage: {
        async delete(key) {
          values.delete(key);
        },
        async read(key) {
          return values.get(key);
        },
        async write(key, value) {
          values.set(key, structuredClone(value));
        },
      },
    });
    const state = {
      batchToken: "b".repeat(43),
      entries: [{ alias: "a".repeat(43), headword: "accountable", itemId: "cloud-item-1" }],
      expiresAt: "2026-08-13T01:05:00.000Z",
      jobId: "cloud-job-1",
      leaseToken: "l".repeat(43),
    };
    await vault.write(state);
    expect(JSON.stringify([...values.values()])).not.toContain("cloud-item-1");
    expect(JSON.stringify([...values.values()])).not.toContain("accountable");
    expect(JSON.stringify([...values.values()])).toContain("huayi-store-external-wordbook-lease");
    await expect(vault.read()).resolves.toEqual(state);
  });
});
