import type { LexiconRepository, WordbookExportEngine, WordEntry } from "@huayi/store-domain";
import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { describe, expect, it, vi } from "vitest";

import { handleLexiconMessage } from "./lexicon-message-handler.js";

function access(eudic: boolean, shanbay: boolean, siteEnabled = true) {
  return async () => ({
    defaultAction: "ask" as const,
    globallyEnabled: true,
    networkConsent: null,
    providerId: "openai" as const,
    recipientAccess: {
      eudic: {
        consent: eudic ? { grantedAt: "2026-08-11T00:00:00.000Z", version: 1 as const } : null,
        enabled: eudic,
      },
      shanbay: {
        consent: shanbay ? { grantedAt: "2026-08-11T00:00:00.000Z", version: 1 as const } : null,
        enabled: shanbay,
      },
    },
    schemaVersion: 5 as const,
    sitePolicy: {
      defaultAction: "allow" as const,
      rules: siteEnabled
        ? []
        : [{ action: "block" as const, hostname: "example.test", includeSubdomains: false }],
    },
    youtubeMode: "english" as const,
    youtubeShortcut: null,
  });
}

const existing: WordEntry = {
  contexts: [
    {
      contextualMeaningZh: "调查",
      id: "context-1",
      observedAt: "2026-08-11T00:00:00.000Z",
      sentence: "The investigation began.",
      source: "web",
    },
  ],
  createdAt: "2026-08-11T00:00:00.000Z",
  headword: "investigation",
  id: "investigation",
  updatedAt: "2026-08-11T00:00:00.000Z",
};

function repository(found: WordEntry | null = null): LexiconRepository {
  return {
    delete: vi.fn(async () => false),
    exportWordList: vi.fn(async () => "investigation\n"),
    findByHeadword: vi.fn(async () => found),
    list: vi.fn(async () => ({ entries: [], nextCursor: null })),
    save: vi.fn(async () => existing),
    snapshot: vi.fn(async () => (found === null ? [] : [found])),
  };
}

function saveRequest(): Record<string, unknown> {
  return {
    contextualMeaningZh: "调查",
    headword: "Investigation",
    messageVersion: STORE_MESSAGE_VERSION,
    sentence: "The investigation began.",
    type: "store/lexicon-save",
  };
}

function wordbook(): WordbookExportEngine {
  return {
    cancelEntry: vi.fn(async () => undefined),
    claimShanbayBatch: vi.fn(async () => null),
    enqueue: vi.fn(async () => []),
    getEudicImportJob: vi.fn(),
    listOutbox: vi.fn(async () => []),
    pauseEudicImport: vi.fn(),
    processEudicImportOnce: vi.fn(async () => false),
    processEudicOnce: vi.fn(async () => false),
    resolveShanbayBatch: vi.fn(async () => false),
    resumeEudicImport: vi.fn(),
    retry: vi.fn(async () => undefined),
    startEudicImport: vi.fn(),
  };
}

describe("Store lexicon one-off message handler", () => {
  it("saves one trusted web observation without forwarding authority fields", async () => {
    const lexicon = repository();
    const exports = wordbook();
    await expect(
      handleLexiconMessage(
        saveRequest(),
        lexicon,
        exports,
        access(true, false),
        "https://example.test/article",
      ),
    ).resolves.toEqual({
      messageVersion: STORE_MESSAGE_VERSION,
      status: "saved",
      type: "store/lexicon-save-result",
    });
    expect(lexicon.save).toHaveBeenCalledWith({
      context: {
        contextualMeaningZh: "调查",
        sentence: "The investigation began.",
        source: "web",
      },
      headword: "investigation",
    });
    expect(exports.enqueue).toHaveBeenCalledWith("investigation", ["eudic"]);
  });

  it("keeps local save successful when all exports are disabled", async () => {
    const lexicon = repository();
    const exports = wordbook();

    await expect(
      handleLexiconMessage(
        saveRequest(),
        lexicon,
        exports,
        access(false, false),
        "https://example.test/article",
      ),
    ).resolves.toMatchObject({ status: "saved" });
    expect(lexicon.save).toHaveBeenCalledOnce();
    expect(exports.enqueue).not.toHaveBeenCalled();
  });

  it("keeps local save successful when optional CloudWordCopy fails", async () => {
    const lexicon = repository();
    const cloudWordCopy = { copy: vi.fn(async () => Promise.reject(new Error("offline"))) };

    await expect(
      handleLexiconMessage(
        saveRequest(),
        lexicon,
        undefined,
        undefined,
        "https://example.test/article",
        cloudWordCopy,
      ),
    ).resolves.toMatchObject({ status: "saved" });
    expect(lexicon.save).toHaveBeenCalledOnce();
    expect(cloudWordCopy.copy).toHaveBeenCalledWith({
      collectedAt: "2026-08-11T00:00:00.000Z",
      contextualMeaningZh: "调查",
      headword: "investigation",
      sentence: "The investigation began.",
    });
  });

  it("blocks a disabled sender before local or export writes", async () => {
    const lexicon = repository();
    const exports = wordbook();

    await expect(
      handleLexiconMessage(
        saveRequest(),
        lexicon,
        exports,
        access(true, true, false),
        "https://example.test/article",
      ),
    ).resolves.toMatchObject({ code: "invalid-request" });
    expect(lexicon.findByHeadword).not.toHaveBeenCalled();
    expect(lexicon.save).not.toHaveBeenCalled();
    expect(exports.enqueue).not.toHaveBeenCalled();
  });

  it("returns duplicate without writing the same normalized web sentence", async () => {
    const lexicon = repository(existing);
    const exports = wordbook();
    await expect(
      handleLexiconMessage(
        { ...saveRequest(), sentence: "  The investigation   began. " },
        lexicon,
        exports,
        access(true, true),
        "https://example.test/article",
      ),
    ).resolves.toMatchObject({ status: "duplicate" });
    expect(lexicon.save).not.toHaveBeenCalled();
    expect(exports.enqueue).toHaveBeenCalledWith("investigation", ["eudic", "shanbay"]);
  });

  it("repairs missing export intents when a save retry becomes a duplicate", async () => {
    const lexicon = repository();
    vi.mocked(lexicon.findByHeadword).mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
    const exports = wordbook();
    vi.mocked(exports.enqueue)
      .mockRejectedValueOnce(Object.assign(new Error(), { code: "concurrent-modification" }))
      .mockResolvedValueOnce([]);

    await expect(
      handleLexiconMessage(
        saveRequest(),
        lexicon,
        exports,
        access(true, true),
        "https://example.test/article",
      ),
    ).resolves.toMatchObject({
      code: "internal-error",
    });
    await expect(
      handleLexiconMessage(
        saveRequest(),
        lexicon,
        exports,
        access(true, true),
        "https://example.test/article",
      ),
    ).resolves.toMatchObject({
      status: "duplicate",
    });
    expect(exports.enqueue).toHaveBeenCalledTimes(2);
  });

  it("derives YouTube authority only from an exact recorded watch sender", async () => {
    const lexicon = repository();

    await expect(
      handleLexiconMessage(
        saveRequest(),
        lexicon,
        undefined,
        undefined,
        "https://www.youtube.com/watch?v=video-1",
      ),
    ).resolves.toMatchObject({ status: "saved" });
    expect(lexicon.save).toHaveBeenCalledWith({
      context: {
        contextualMeaningZh: "调查",
        sentence: "The investigation began.",
        source: "youtube",
      },
      headword: "investigation",
    });

    await expect(
      handleLexiconMessage(
        saveRequest(),
        repository(),
        undefined,
        undefined,
        "https://www.youtube.com/shorts/video-1",
      ),
    ).resolves.toMatchObject({ code: "invalid-request" });
  });

  it("supports optional presence without exposing an entry", async () => {
    const lexicon = repository(existing);
    await expect(
      handleLexiconMessage(
        {
          headword: "Investigation",
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/lexicon-presence",
        },
        lexicon,
      ),
    ).resolves.toEqual({
      messageVersion: STORE_MESSAGE_VERSION,
      present: true,
      type: "store/lexicon-presence-result",
    });
  });

  it("rejects unknown fields before repository access and maps safe storage errors", async () => {
    const lexicon = repository();
    await expect(
      handleLexiconMessage({ ...saveRequest(), url: "https://example.test" }, lexicon),
    ).resolves.toMatchObject({ code: "invalid-request" });
    expect(lexicon.findByHeadword).not.toHaveBeenCalled();

    vi.mocked(lexicon.findByHeadword).mockRejectedValueOnce(
      Object.assign(new Error("secret storage details"), { code: "unexpected-private-code" }),
    );
    await expect(
      handleLexiconMessage(
        saveRequest(),
        lexicon,
        undefined,
        undefined,
        "https://example.test/article",
      ),
    ).resolves.toMatchObject({
      code: "internal-error",
    });
    vi.mocked(lexicon.findByHeadword).mockRejectedValueOnce(
      Object.assign(new Error("ciphertext"), { code: "data-corrupt" }),
    );
    await expect(
      handleLexiconMessage(
        saveRequest(),
        lexicon,
        undefined,
        undefined,
        "https://example.test/article",
      ),
    ).resolves.toMatchObject({
      code: "data-corrupt",
    });
  });

  it("does not claim unrelated messages", async () => {
    await expect(handleLexiconMessage({ type: "store/handshake" }, repository())).resolves.toBe(
      undefined,
    );
  });
});
