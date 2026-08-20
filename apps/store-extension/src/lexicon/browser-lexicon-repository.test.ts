import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import type { ContextObservationInput, LexiconRepository } from "@huayi/store-domain";

import { createBrowserLexiconRepository } from "./browser-lexicon-repository.js";
import { createIndexedDbLexiconStore } from "./indexeddb-lexicon-store.js";
import type { DeviceDekSource } from "./device-dek-source.js";

const DEK = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

interface RepositoryFixture {
  readonly databaseName: string;
  readonly factory: IDBFactory;
  readonly repository: LexiconRepository;
}

function createFixture(
  factory = new IDBFactory(),
  databaseName = `lexicon-${crypto.randomUUID()}`,
  dekSource: DeviceDekSource = { read: async () => Uint8Array.from(DEK) },
): RepositoryFixture {
  let tick = 0;
  return {
    databaseName,
    factory,
    repository: createBrowserLexiconRepository({
      clock: () => new Date(Date.UTC(2026, 7, 11, 0, 0, tick++)),
      crypto: globalThis.crypto,
      dekSource,
      randomId: () => `observation-${crypto.randomUUID()}`,
      store: createIndexedDbLexiconStore({ databaseName, indexedDB: factory }),
    }),
  };
}

function context(
  sentence: string,
  contextualMeaningZh: string,
  source: "web" | "youtube" = "web",
): ContextObservationInput {
  return { contextualMeaningZh, sentence, source };
}

describe("BrowserLexiconRepository", () => {
  it("exports one normalized unique headword per line in alphabetical order", async () => {
    const { repository } = createFixture();
    await repository.save({ headword: "Zebra" });
    await repository.save({ headword: "apple" });
    await repository.save({ headword: "APPLE" });

    await expect(repository.exportWordList()).resolves.toBe("apple\nzebra\n");
    await expect(repository.snapshot()).resolves.toMatchObject([
      { contexts: [], id: "apple" },
      { contexts: [], id: "zebra" },
    ]);
  });
  it("normalizes word identity and keeps multiple deduplicated contexts", async () => {
    const { repository } = createFixture();

    const first = await repository.save({
      context: context("I can’t bear it.", "忍受"),
      headword: "  CAN’T  ",
    });
    const duplicate = await repository.save({
      context: context("  I can’t   bear it. ", "不会覆盖已有释义"),
      headword: "can't",
    });
    const second = await repository.save({
      context: context("YouTube can’t autoplay.", "不能", "youtube"),
      headword: "can't",
    });

    expect(first.id).toBe("can't");
    expect(duplicate).toEqual(first);
    expect(second.contexts).toHaveLength(2);
    expect(
      second.contexts.flatMap((item) =>
        "contextualMeaningZh" in item ? [item.contextualMeaningZh] : [],
      ),
    ).toEqual(["忍受", "不能"]);
    await expect(repository.findByHeadword("CAN’T")).resolves.toEqual(second);
  });

  it("lists and searches deterministically with opaque cursors", async () => {
    const { repository } = createFixture();
    await repository.save({ headword: "zebra" });
    await repository.save({ headword: "Apple" });
    await repository.save({ headword: "application" });

    const firstPage = await repository.list({ limit: 2 });
    expect(firstPage.entries.map((entry) => entry.id)).toEqual(["apple", "application"]);
    expect(firstPage.nextCursor).toMatch(/^[a-f0-9]{64}$/);
    expect(firstPage.nextCursor).not.toContain("application");
    if (firstPage.nextCursor === null) {
      throw new Error("Expected a continuation cursor.");
    }

    await expect(
      repository.list({ cursor: firstPage.nextCursor, limit: 2 }),
    ).resolves.toMatchObject({
      entries: [{ id: "zebra" }],
      nextCursor: null,
    });
    await expect(repository.list({ limit: 10, search: "APP" })).resolves.toMatchObject({
      entries: [{ id: "apple" }, { id: "application" }],
    });
  });

  it("deletes locally and reports missing entries without recreating them", async () => {
    const { repository } = createFixture();
    await repository.save({ headword: "removed" });

    await expect(repository.delete("REMOVED")).resolves.toBe(true);
    await expect(repository.delete("removed")).resolves.toBe(false);
    await expect(repository.findByHeadword("removed")).resolves.toBeNull();
  });

  it("preserves concurrent contexts across independent repository instances", async () => {
    const factory = new IDBFactory();
    const databaseName = `lexicon-${crypto.randomUUID()}`;
    const first = createFixture(factory, databaseName).repository;
    const second = createFixture(factory, databaseName).repository;

    await Promise.all([
      first.save({ context: context("First sentence.", "第一"), headword: "race" }),
      second.save({ context: context("Second sentence.", "第二"), headword: "race" }),
    ]);

    const saved = await first.findByHeadword("race");
    expect(
      saved?.contexts
        .flatMap((item) => ("contextualMeaningZh" in item ? [item.contextualMeaningZh] : []))
        .sort(),
    ).toEqual(["第一", "第二"]);
  });

  it("fails closed when the device DEK source reports corruption", async () => {
    const { repository } = createFixture(new IDBFactory(), undefined, {
      read: async () => {
        throw Object.assign(new Error("corrupt"), { code: "data-corrupt" });
      },
    });

    await expect(repository.save({ headword: "secret" })).rejects.toMatchObject({
      code: "data-corrupt",
    });
    await expect(repository.list({ limit: 10 })).rejects.toMatchObject({
      code: "data-corrupt",
    });
  });
});
