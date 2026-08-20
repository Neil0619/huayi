import { describe, expect, it, vi } from "vitest";

import { createCloudShanbayBridge } from "./cloud-shanbay-bridge.js";
import type { CloudWordbookApi } from "./cloud-wordbook-api.js";
import type { ExternalWordbookLeaseState } from "./external-wordbook-lease-vault.js";

describe("Cloud Shanbay bridge", () => {
  it("persists cloud proof but gives Content only local aliases and headwords", async () => {
    let saved: ExternalWordbookLeaseState | null = null;
    const api = {
      lease: vi.fn(async () => ({
        entries: [{ headword: "accountable", itemId: "cloud-item-1" }],
        expiresAt: "2026-08-13T01:05:00.000Z",
        jobId: "cloud-job-1",
        kind: "export" as const,
        leaseToken: "l".repeat(43),
      })),
      list: vi.fn(async () => ({
        items: [{ id: "cloud-job-1", revision: 1 }],
        nextCursor: null,
      })),
      submit: vi.fn(async () => ({ job: {} })),
    } as unknown as CloudWordbookApi;
    const ids = ["n", "batch", "alias"].map((value) => value.repeat(43));
    const bridge = createCloudShanbayBridge({
      allow: async () => true,
      api,
      idempotencyKey: () => "receipt-1",
      randomId: () => ids.shift() ?? "x".repeat(43),
      sessionVault: {
        readSession: async () => ({
          expiresAt: "2099-01-01T00:00:00.000Z",
          preferences: {
            cloudWordCopyMode: "enabled",
            extensionQueryModelMode: "platform",
            revision: 1,
            studyCaptureMode: "manual",
            updatedAt: "2026-08-13T00:00:00.000Z",
          },
          token: "s".repeat(43),
        }),
      },
      vault: {
        clear: async () => {
          saved = null;
        },
        read: async () => saved,
        write: async (value) => {
          saved = value;
        },
      },
    });
    const batch = await bridge.claimShanbayBatch(100);
    expect(batch).toEqual({
      items: [{ entryId: "accountable", outboxId: "alias".repeat(43) }],
      token: "batch".repeat(43),
    });
    expect(JSON.stringify(batch)).not.toContain("cloud-item-1");
    expect(JSON.stringify(batch)).not.toContain("l".repeat(43));
    await expect(
      bridge.resolveShanbayBatch("batch".repeat(43), ["alias".repeat(43)], []),
    ).resolves.toBe(true);
    expect(api.submit).toHaveBeenCalledWith(
      "cloud-job-1",
      expect.objectContaining({ receipts: [{ itemId: "cloud-item-1", outcome: "confirmed" }] }),
      "receipt-1",
      "s".repeat(43),
    );
    expect(saved).toBeNull();
  });
});
