import type { WordbookExportEngine } from "@huayi/store-domain";
import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { describe, expect, it, vi } from "vitest";

import { handleShanbayMessage } from "./shanbay-message-handler.js";

function access(consented: boolean, enabled: boolean, siteEnabled = true) {
  return async () => ({
    defaultAction: "ask" as const,
    globallyEnabled: true,
    networkConsent: null,
    providerId: "openai" as const,
    recipientAccess: {
      eudic: { consent: null, enabled: false },
      shanbay: {
        consent: consented ? { grantedAt: "2026-08-11T00:00:00.000Z", version: 1 as const } : null,
        enabled,
      },
    },
    schemaVersion: 5 as const,
    sitePolicy: {
      defaultAction: "allow" as const,
      rules: siteEnabled
        ? []
        : [{ action: "block" as const, hostname: "web.shanbay.com", includeSubdomains: false }],
    },
    youtubeMode: "english" as const,
    youtubeShortcut: null,
  });
}

function wordbook(): WordbookExportEngine {
  return {
    cancelEntry: vi.fn(async () => undefined),
    claimShanbayBatch: vi.fn(async () => ({
      items: [{ entryId: "investigation", outboxId: "outbox-1" }],
      token: "lease-token",
    })),
    enqueue: vi.fn(async () => []),
    getEudicImportJob: vi.fn(),
    listOutbox: vi.fn(async () => []),
    pauseEudicImport: vi.fn(),
    processEudicImportOnce: vi.fn(async () => false),
    processEudicOnce: vi.fn(async () => false),
    resolveShanbayBatch: vi.fn(async () => true),
    resumeEudicImport: vi.fn(),
    retry: vi.fn(async () => undefined),
    startEudicImport: vi.fn(),
  };
}

const ready = { messageVersion: STORE_MESSAGE_VERSION, type: "store/shanbay-page-ready" };

describe("Store Shanbay worker message handler", () => {
  it("requires the exact sender page and never trusts a message URL", async () => {
    const engine = wordbook();
    await expect(
      handleShanbayMessage(
        ready,
        { url: "https://web.shanbay.com/wordsweb/#/collection" },
        engine,
        access(true, true),
      ),
    ).resolves.toMatchObject({ batch: { token: "lease-token" }, type: "store/shanbay-batch" });

    for (const url of [
      "https://evil.invalid/wordsweb/#/collection",
      "https://web.shanbay.com/wordsweb/#/other",
      "https://web.shanbay.com.evil.invalid/wordsweb/#/collection",
    ]) {
      await expect(
        handleShanbayMessage(ready, { url }, engine, access(true, true)),
      ).resolves.toBeUndefined();
    }
    await expect(
      handleShanbayMessage(
        { ...ready, url: "https://web.shanbay.com/wordsweb/#/collection" },
        { url: "https://evil.invalid/" },
        engine,
        access(true, true),
      ),
    ).resolves.toBeUndefined();
    expect(engine.claimShanbayBatch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [false, true, "consent-required"],
    [true, false, "recipient-disabled"],
  ] as const)("blocks Shanbay claim before prefill", async (consented, enabled, code) => {
    const engine = wordbook();
    await expect(
      handleShanbayMessage(
        ready,
        { url: "https://web.shanbay.com/wordsweb/#/collection" },
        engine,
        access(consented, enabled),
      ),
    ).resolves.toMatchObject({ code, type: "store/wordbook-error" });
    expect(engine.claimShanbayBatch).not.toHaveBeenCalled();
  });

  it("blocks a site-disabled Shanbay sender before claim", async () => {
    const engine = wordbook();
    await expect(
      handleShanbayMessage(
        ready,
        { url: "https://web.shanbay.com/wordsweb/#/collection" },
        engine,
        access(true, true, false),
      ),
    ).resolves.toMatchObject({ code: "invalid-request" });
    expect(engine.claimShanbayBatch).not.toHaveBeenCalled();
  });

  it("rejects unknown receipt fields before touching the current lease", async () => {
    const engine = wordbook();
    await expect(
      handleShanbayMessage(
        {
          batchToken: "lease-token",
          confirmedOutboxIds: ["outbox-1"],
          failedOutboxIds: [],
          messageVersion: STORE_MESSAGE_VERSION,
          rawPageText: "secret",
          type: "store/shanbay-resolve",
        },
        { url: "https://web.shanbay.com/wordsweb/#/collection" },
        engine,
        access(true, true),
      ),
    ).resolves.toMatchObject({ code: "invalid-request" });
    expect(engine.resolveShanbayBatch).not.toHaveBeenCalled();
  });
});
