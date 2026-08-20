import type { LexiconRepository, WordEntry } from "@huayi/store-domain";
import { describe, expect, it, vi } from "vitest";

import { createBrowserWordbookExportEngine } from "./browser-wordbook-export-engine.js";
import type { EudicWordbookClient } from "./eudic-client.js";
import { createMemoryWordbookStateStore } from "./memory-wordbook-state-store.js";
import type { WordbookStateStore } from "./wordbook-state.js";

const entry: WordEntry = {
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

function lexicon(current: WordEntry | null = entry): LexiconRepository {
  return {
    delete: vi.fn(async () => false),
    exportWordList: vi.fn(async () => "investigation\n"),
    findByHeadword: vi.fn(async () => current),
    list: vi.fn(async () => ({ entries: [], nextCursor: null })),
    save: vi.fn(async () => entry),
    snapshot: vi.fn(async () => (current === null ? [] : [current])),
  };
}

function createHarness(
  options: {
    readonly current?: WordEntry | null;
    readonly now?: { value: number };
    readonly stateStore?: WordbookStateStore;
  } = {},
) {
  const now = options.now ?? { value: Date.parse("2026-08-11T00:00:00.000Z") };
  const eudic = {
    addWord: vi.fn<EudicWordbookClient["addWord"]>(async () => "already-present"),
    listWords: vi.fn<EudicWordbookClient["listWords"]>(async () => []),
  };
  const repository = lexicon(options.current === undefined ? entry : options.current);
  const engine = createBrowserWordbookExportEngine({
    clock: () => new Date(now.value),
    eudic,
    leaseDurationMs: 60_000,
    lexicon: repository,
    randomId: () => crypto.randomUUID(),
    stateStore: options.stateStore ?? createMemoryWordbookStateStore(),
  });
  return { engine, eudic, repository };
}

describe("browser WordbookExportEngine", () => {
  it("claims one Eudic task, performs idempotent export outside storage, and records a receipt", async () => {
    const { engine, eudic } = createHarness();
    const [queued] = await engine.enqueue("investigation", ["eudic"]);
    expect(queued?.state).toBe("queued");

    await expect(engine.processEudicOnce(new AbortController().signal)).resolves.toBe(true);
    await expect(engine.listOutbox()).resolves.toEqual([
      expect.objectContaining({
        receipt: expect.objectContaining({ outcome: "already-present" }),
        state: "delivered",
      }),
    ]);
    expect(eudic.addWord).toHaveBeenCalledWith(
      "investigation",
      "The investigation began.",
      expect.any(AbortSignal),
    );
  });

  it("never sends a deleted local entry", async () => {
    const missing = createHarness({ current: null });
    await missing.engine.enqueue("investigation", ["eudic"]);
    await expect(missing.engine.processEudicOnce(new AbortController().signal)).resolves.toBe(true);
    await expect(missing.engine.listOutbox()).resolves.toEqual([
      expect.objectContaining({ state: "cancelled" }),
    ]);
    expect(missing.eudic.addWord).not.toHaveBeenCalled();
  });

  it("reclaims an expired lease and ignores the first worker's late acknowledgement", async () => {
    const stateStore = createMemoryWordbookStateStore();
    const now = { value: Date.parse("2026-08-11T00:00:00.000Z") };
    let release: (outcome: "created") => void = () => undefined;
    const firstResult = new Promise<"created">((resolve) => {
      release = resolve;
    });
    const first = createHarness({ now, stateStore });
    vi.mocked(first.eudic.addWord).mockReturnValueOnce(firstResult);
    await first.engine.enqueue("investigation", ["eudic"]);
    const pending = first.engine.processEudicOnce(new AbortController().signal);
    await vi.waitFor(() => expect(first.eudic.addWord).toHaveBeenCalledOnce());

    now.value += 60_001;
    const second = createHarness({ now, stateStore });
    await expect(second.engine.processEudicOnce(new AbortController().signal)).resolves.toBe(true);
    release("created");
    await pending;

    await expect(second.engine.listOutbox()).resolves.toEqual([
      expect.objectContaining({
        attemptCount: 2,
        receipt: expect.objectContaining({ outcome: "already-present" }),
        state: "delivered",
      }),
    ]);
  });

  it("requires an explicit retry after a recoverable Eudic failure", async () => {
    const { engine, eudic } = createHarness();
    vi.mocked(eudic.addWord)
      .mockRejectedValueOnce(Object.assign(new Error("offline"), { code: "network-error" }))
      .mockResolvedValueOnce("created");
    const [queued] = await engine.enqueue("investigation", ["eudic"]);
    await engine.processEudicOnce(new AbortController().signal);
    await expect(engine.listOutbox()).resolves.toEqual([
      expect.objectContaining({ lastError: "network-error", state: "failed" }),
    ]);
    await expect(engine.processEudicOnce(new AbortController().signal)).resolves.toBe(false);
    if (queued === undefined) throw new Error("Expected a queued outbox item.");
    await engine.retry(queued.id);
    await expect(engine.processEudicOnce(new AbortController().signal)).resolves.toBe(true);
    await expect(engine.listOutbox()).resolves.toEqual([
      expect.objectContaining({ receipt: expect.objectContaining({ outcome: "created" }) }),
    ]);
  });

  it("claims a bounded Shanbay batch and records partial success without losing failures", async () => {
    const { engine } = createHarness();
    await engine.enqueue("investigation", ["shanbay"]);
    await engine.enqueue("evidence", ["shanbay"]);

    const batch = await engine.claimShanbayBatch(2);
    expect(batch).toEqual({
      items: [
        expect.objectContaining({ entryId: "investigation" }),
        expect.objectContaining({ entryId: "evidence" }),
      ],
      token: expect.any(String),
    });
    if (batch === null) throw new Error("Expected Shanbay batch.");

    await expect(
      engine.resolveShanbayBatch(
        batch.token,
        [batch.items[0]?.outboxId ?? ""],
        [batch.items[1]?.outboxId ?? ""],
      ),
    ).resolves.toBe(true);
    await expect(engine.listOutbox()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: "delivered", target: "shanbay" }),
        expect.objectContaining({ state: "queued", target: "shanbay" }),
      ]),
    );
  });

  it("fails closed for stale Shanbay receipts and a delete racing an active lease", async () => {
    const { engine } = createHarness();
    await engine.enqueue("investigation", ["shanbay"]);
    const batch = await engine.claimShanbayBatch(1);
    if (batch === null) throw new Error("Expected Shanbay batch.");

    await engine.cancelEntry("investigation");
    await expect(
      engine.resolveShanbayBatch(batch.token, [batch.items[0]?.outboxId ?? ""], []),
    ).resolves.toBe(false);
    await expect(engine.listOutbox()).resolves.toEqual([
      expect.objectContaining({ state: "cancelled", target: "shanbay" }),
    ]);
  });

  it("reports a busy Shanbay batch, reclaims expiry, and rejects the old token", async () => {
    const stateStore = createMemoryWordbookStateStore();
    const now = { value: Date.parse("2026-08-11T00:00:00.000Z") };
    const first = createHarness({ now, stateStore });
    await first.engine.enqueue("investigation", ["shanbay"]);
    const firstBatch = await first.engine.claimShanbayBatch(1);
    if (firstBatch === null) throw new Error("Expected first Shanbay batch.");
    await expect(first.engine.claimShanbayBatch(1)).resolves.toBeNull();

    now.value += 60_001;
    const second = createHarness({ now, stateStore });
    const secondBatch = await second.engine.claimShanbayBatch(1);
    if (secondBatch === null) throw new Error("Expected reclaimed Shanbay batch.");
    expect(secondBatch.token).not.toBe(firstBatch.token);
    await expect(
      first.engine.resolveShanbayBatch(firstBatch.token, [firstBatch.items[0]?.outboxId ?? ""], []),
    ).resolves.toBe(false);
  });

  it("keeps an in-flight Eudic export auditable when local deletion races the network", async () => {
    let release: (outcome: "created") => void = () => undefined;
    const response = new Promise<"created">((resolve) => {
      release = resolve;
    });
    const { engine, eudic } = createHarness();
    vi.mocked(eudic.addWord).mockReturnValueOnce(response);
    await engine.enqueue("investigation", ["eudic"]);
    const pending = engine.processEudicOnce(new AbortController().signal);
    await vi.waitFor(() => expect(eudic.addWord).toHaveBeenCalledOnce());

    await engine.cancelEntry("investigation");
    await expect(engine.listOutbox()).resolves.toEqual([
      expect.objectContaining({ state: "in-flight", target: "eudic" }),
    ]);
    release("created");
    await pending;
    await expect(engine.listOutbox()).resolves.toEqual([
      expect.objectContaining({ state: "delivered", target: "eudic" }),
    ]);
  });

  it("imports bounded Eudic pages with context_line and reports the public source limit", async () => {
    const { engine, eudic, repository } = createHarness({ current: null });
    vi.mocked(eudic.listWords).mockResolvedValue(
      Array.from({ length: 100 }, (_, index) => ({
        addedAt: "2026-08-10T00:00:00.000Z",
        contextLine: `Context ${index}`,
        headword: `word${index}`,
      })),
    );

    await engine.startEudicImport();
    let job = await engine.getEudicImportJob();
    for (let page = 0; page <= 50; page += 1) {
      await engine.processEudicImportOnce(new AbortController().signal);
      job = await engine.getEudicImportJob();
    }
    expect(job).toMatchObject({ nextPage: 51, state: "source-limit-reached" });
    expect(eudic.listWords).toHaveBeenLastCalledWith(50, expect.any(AbortSignal));
    expect(repository.save).toHaveBeenCalledWith({
      context: {
        observedAt: "2026-08-10T00:00:00.000Z",
        sentence: "Context 0",
        source: "eudic-import",
      },
      headword: "word0",
    });
  });

  it("completes on a short page and keeps a failed checkpoint resumable", async () => {
    const completed = createHarness({ current: null });
    vi.mocked(completed.eudic.listWords).mockResolvedValueOnce([]);
    await completed.engine.startEudicImport();
    await completed.engine.processEudicImportOnce(new AbortController().signal);
    await expect(completed.engine.getEudicImportJob()).resolves.toMatchObject({
      nextPage: 0,
      state: "completed",
    });

    const failed = createHarness({ current: null });
    vi.mocked(failed.eudic.listWords).mockRejectedValueOnce(
      Object.assign(new Error("offline"), { code: "network-error" }),
    );
    await failed.engine.startEudicImport();
    await failed.engine.processEudicImportOnce(new AbortController().signal);
    await expect(failed.engine.getEudicImportJob()).resolves.toMatchObject({
      lastError: "network-error",
      nextPage: 0,
      state: "failed",
    });
    await failed.engine.resumeEudicImport();
    await failed.engine.processEudicImportOnce(new AbortController().signal);
    await expect(failed.engine.getEudicImportJob()).resolves.toMatchObject({
      nextPage: 0,
      state: "completed",
    });
  });
});
