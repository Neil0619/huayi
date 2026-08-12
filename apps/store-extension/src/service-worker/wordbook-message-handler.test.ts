import type { WordbookExportEngine } from "@huayi/store-domain";
import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { describe, expect, it, vi } from "vitest";

import { handleWordbookMessage } from "./wordbook-message-handler.js";

function access(consented: boolean, enabled: boolean) {
  return async () => ({
    defaultAction: "ask" as const,
    globallyEnabled: true,
    networkConsent: null,
    providerId: "openai" as const,
    recipientAccess: {
      eudic: {
        consent: consented ? { grantedAt: "2026-08-11T00:00:00.000Z", version: 1 as const } : null,
        enabled,
      },
      shanbay: { consent: null, enabled: false },
    },
    schemaVersion: 5 as const,
    sitePolicy: { defaultAction: "allow" as const, rules: [] },
    youtubeMode: "english" as const,
    youtubeShortcut: null,
  });
}

function wordbook(): WordbookExportEngine {
  return {
    cancelEntry: vi.fn(async () => undefined),
    claimShanbayBatch: vi.fn(async () => null),
    enqueue: vi.fn(async () => []),
    getEudicImportJob: vi.fn(async () => ({
      duplicateCount: 0,
      importedCount: 4,
      nextPage: 2,
      state: "paused" as const,
      updatedAt: "2026-08-11T00:00:00.000Z",
    })),
    listOutbox: vi.fn(async () => []),
    pauseEudicImport: vi.fn(),
    processEudicImportOnce: vi.fn(async () => true),
    processEudicOnce: vi.fn(async () => false),
    resolveShanbayBatch: vi.fn(async () => false),
    resumeEudicImport: vi.fn(),
    retry: vi.fn(async () => undefined),
    startEudicImport: vi.fn(),
  };
}

describe("Store wordbook options message handler", () => {
  it("requires this extension's exact Options sender and rejects unknown fields", async () => {
    const engine = wordbook();
    const request = { messageVersion: STORE_MESSAGE_VERSION, type: "store/eudic-import-status" };
    await expect(
      handleWordbookMessage(
        request,
        { id: "extension-id", url: "chrome-extension://extension-id/options.html" },
        "extension-id",
        engine,
        access(true, true),
      ),
    ).resolves.toMatchObject({ job: { importedCount: 4 } });
    await expect(
      handleWordbookMessage(
        request,
        { id: "extension-id", url: "https://example.test/" },
        "extension-id",
        engine,
        access(true, true),
      ),
    ).resolves.toBeUndefined();
    vi.mocked(engine.getEudicImportJob).mockClear();

    await expect(
      handleWordbookMessage(
        {
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/eudic-import-status",
          url: "https://api.frdic.com/evil",
        },
        { id: "extension-id", url: "chrome-extension://extension-id/options.html" },
        "extension-id",
        engine,
        access(true, true),
      ),
    ).resolves.toMatchObject({ code: "invalid-request" });
    expect(engine.getEudicImportJob).not.toHaveBeenCalled();
  });

  it("processes at most one import page and returns the persisted checkpoint", async () => {
    const engine = wordbook();
    await expect(
      handleWordbookMessage(
        { messageVersion: STORE_MESSAGE_VERSION, type: "store/eudic-import-step" },
        { id: "extension-id", url: "chrome-extension://extension-id/options.html" },
        "extension-id",
        engine,
        access(true, true),
      ),
    ).resolves.toMatchObject({ job: { importedCount: 4, nextPage: 2, state: "paused" } });
    expect(engine.processEudicImportOnce).toHaveBeenCalledOnce();
  });

  it.each([
    [false, true, "consent-required"],
    [true, false, "recipient-disabled"],
  ] as const)("blocks Eudic before engine access", async (consented, enabled, code) => {
    const engine = wordbook();
    await expect(
      handleWordbookMessage(
        { messageVersion: STORE_MESSAGE_VERSION, type: "store/eudic-import-start" },
        { id: "extension-id", url: "chrome-extension://extension-id/options.html" },
        "extension-id",
        engine,
        access(consented, enabled),
      ),
    ).resolves.toMatchObject({ code, type: "store/wordbook-error" });
    expect(engine.startEudicImport).not.toHaveBeenCalled();
    expect(engine.processEudicImportOnce).not.toHaveBeenCalled();
  });
});
