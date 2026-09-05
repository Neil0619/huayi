import { readFileSync } from "node:fs";

import type { LexiconRepository, WordbookExportEngine, WordEntry } from "@huayi/store-domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LexiconOptionsController, type TextFileAdapter } from "./lexicon-options-controller.js";

const optionsHtml = readFileSync("apps/store-extension/pages/options.html", "utf8");

const entries: readonly WordEntry[] = [
  {
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
  },
];

function renderPage(): void {
  document.documentElement.innerHTML = optionsHtml;
}

function element<ElementType extends HTMLElement>(selector: string): ElementType {
  const found = document.querySelector<ElementType>(selector);
  if (found === null) throw new Error(`Missing test element: ${selector}`);
  return found;
}

function submit(selector: string): void {
  element<HTMLFormElement>(selector).dispatchEvent(new Event("submit", { cancelable: true }));
}

function repository(): LexiconRepository {
  return {
    delete: vi.fn(async () => true),
    exportWordList: vi.fn(async () => "investigation\nzebra\n"),
    findByHeadword: vi.fn(async () => null),
    list: vi.fn(async () => ({ entries, nextCursor: "a".repeat(64) })),
    save: vi.fn(async () => entries[0] as WordEntry),
    snapshot: vi.fn(async () => entries),
  };
}

function files(): TextFileAdapter {
  return {
    downloadText: vi.fn(async () => undefined),
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

function harness(overrides?: {
  readonly confirmDelete?: () => boolean;
  readonly files?: TextFileAdapter;
  readonly lexicon?: LexiconRepository;
}): {
  readonly controller: LexiconOptionsController;
  readonly files: TextFileAdapter;
  readonly lexicon: LexiconRepository;
  readonly wordbook: WordbookExportEngine;
} {
  const lexicon = overrides?.lexicon ?? repository();
  const fileAdapter = overrides?.files ?? files();
  const exports = wordbook();
  return {
    controller: new LexiconOptionsController({
      clock: () => new Date("2026-08-11T12:34:56.000Z"),
      confirmDelete: overrides?.confirmDelete ?? (() => true),
      files: fileAdapter,
      lexicon,
      wordbook: exports,
    }),
    files: fileAdapter,
    lexicon,
    wordbook: exports,
  };
}

afterEach(() => {
  document.documentElement.replaceChildren(
    document.createElement("head"),
    document.createElement("body"),
  );
  vi.restoreAllMocks();
});

describe("Lexicon options controller", () => {
  it("lists, searches, paginates, renders contexts, and deletes only after local confirmation", async () => {
    renderPage();
    const { controller, lexicon, wordbook: exports } = harness();
    await controller.initialize(true);

    expect(element("[data-lexicon-list]").textContent).toContain("investigation");
    expect(element("[data-lexicon-list]").textContent).toContain("The investigation began.");
    expect(element("[data-local-delete-disclosure]").textContent).toContain("与学习工作台独立管理");

    element<HTMLInputElement>("[data-lexicon-search]").value = "Invest";
    submit("[data-lexicon-search-form]");
    await vi.waitFor(() =>
      expect(lexicon.list).toHaveBeenLastCalledWith({ limit: 20, search: "Invest" }),
    );
    await vi.waitFor(() =>
      expect(element("[data-lexicon-panel]").getAttribute("aria-busy")).toBe("false"),
    );

    element<HTMLButtonElement>("[data-lexicon-next]").click();
    await vi.waitFor(() =>
      expect(lexicon.list).toHaveBeenLastCalledWith({
        cursor: "a".repeat(64),
        limit: 20,
        search: "Invest",
      }),
    );
    await vi.waitFor(() =>
      expect(element("[data-lexicon-panel]").getAttribute("aria-busy")).toBe("false"),
    );

    element<HTMLButtonElement>("[data-delete-entry]").click();
    await vi.waitFor(() => expect(lexicon.delete).toHaveBeenCalledWith("investigation"));
    expect(exports.cancelEntry).toHaveBeenCalledWith("investigation");
  });

  it("downloads one normalized headword per line without confirmation or backup controls", async () => {
    renderPage();
    const fixture = harness();
    await fixture.controller.initialize(true);

    expect(document.querySelector("[data-backup-export-form]")).toBeNull();
    expect(document.querySelector("[data-backup-restore-form]")).toBeNull();
    expect(document.querySelector("[data-plaintext-export-form]")).toBeNull();
    element<HTMLButtonElement>("[data-word-list-export]").click();
    await vi.waitFor(() => expect(fixture.files.downloadText).toHaveBeenCalledOnce());
    expect(fixture.files.downloadText).toHaveBeenCalledWith(
      "huayi-words-2026-08-11.txt",
      "investigation\nzebra\n",
      "text/plain;charset=utf-8",
    );
  });

  it("hides and clears sensitive rendering while legacy migration is required", async () => {
    renderPage();
    const fixture = harness();
    await fixture.controller.initialize(true);
    await fixture.controller.setReady(false);

    expect(element<HTMLElement>("[data-lexicon-panel]").hidden).toBe(true);
    expect(element("[data-lexicon-list]").textContent).toBe("");
  });

  it("fails closed before deleting locally when outbox cancellation fails", async () => {
    renderPage();
    const fixture = harness();
    vi.mocked(fixture.wordbook.cancelEntry).mockRejectedValueOnce(
      Object.assign(new Error(), { code: "concurrent-modification" }),
    );
    await fixture.controller.initialize(true);

    element<HTMLButtonElement>("[data-delete-entry]").click();
    await vi.waitFor(() =>
      expect(element("[data-lexicon-status]").textContent).toContain("请重试"),
    );
    expect(fixture.lexicon.delete).not.toHaveBeenCalled();
  });
});
