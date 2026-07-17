import { join } from "node:path";

import type { AnalyzeRequest } from "@huayi/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CodexAppServer, CodexTurnRequest } from "../runtime/codex-app-server-lifecycle.js";
import { CodexProviderError } from "../runtime/error-mapper.js";
import type { AnalysisStreamUpdate } from "./analysis-provider.js";
import { CodexAppServerProvider } from "./codex-app-server-provider.js";
import { ModelSchemaRepository } from "./model-schema-repository.js";
import type { ProviderValidationDiagnostic } from "./provider-validation.js";

const { readFileMock } = vi.hoisted(() => ({ readFileMock: vi.fn() }));

vi.mock("node:fs/promises", () => ({ readFile: readFileMock }));

interface FakeRun {
  deltas: string[];
  error?: unknown;
  finalText: string;
}

class FakeAppServer implements CodexAppServer {
  readonly interruptCalls: string[] = [];
  readonly interruptCountsAfterDelta: number[] = [];
  readonly requests: CodexTurnRequest[] = [];
  disposeCalls = 0;
  private readonly runs: FakeRun[];

  constructor(runs: FakeRun[]) {
    this.runs = [...runs];
  }

  async runTurn(request: CodexTurnRequest): Promise<string> {
    this.requests.push(request);
    const run = this.runs.shift();
    if (run === undefined) throw new Error("Missing fake App Server run.");
    for (const delta of run.deltas) {
      request.onAssistantDelta(delta);
      this.interruptCountsAfterDelta.push(this.interruptCalls.length);
    }
    if (run.error !== undefined) throw run.error;
    return run.finalText;
  }

  interrupt(requestId: string): Promise<void> {
    this.interruptCalls.push(requestId);
    return Promise.resolve();
  }

  warmup(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): void {
    this.disposeCalls += 1;
  }
}

const lexicalTranslationContent = {
  pronunciation: { uk: "/ɪnˌvestɪˈɡeɪʃn/", us: null },
  contextualSense: { meaningZh: "调查行为", partOfSpeech: "noun" },
  dictionaryForm: "investigation",
  commonMeanings: [{ meaningsZh: ["调查", "侦查"], partOfSpeech: "noun" }],
  commonPhrases: [{ meaningZh: "刑事调查", text: "criminal investigation" }],
  confusableWords: [],
};

const wordExplanationContent = {
  contextualAnalysisZh: "此处指正式调查，因为它作宾语从句的主语。",
  wordForm: { baseForm: "investigation", formTypeZh: "名词单数", sentenceRoleZh: "主语" },
  wordFormationZh: "investigate 加后缀 -ion 构成名词。",
  usageNotes: [],
  synonyms: [],
};

const passageTranslationContent = {
  translationZh: "第一句。\n第二句。",
};

const sentenceExplanationContent = {
  mainStructure: "He said ... and urged anyone ...",
  translationZh: "他说调查仍处于早期阶段。",
  contextRole: "说明调查阶段并发出征集线索的呼吁。",
  keyExpressions: [{ meaningZh: "处于早期阶段", text: "in its early stages" }],
};

function createRequest(overrides: Partial<AnalyzeRequest> = {}): AnalyzeRequest {
  return {
    action: "translate",
    context: "The investigation was in its early stages.",
    requestId: "analysis-1",
    schemaVersion: 5,
    selection: "investigation",
    selectionKind: "word",
    sentenceContext: "The investigation was in its early stages.",
    targetLanguage: "zh-CN",
    type: "analyze",
    ...overrides,
  };
}

function createProvider(
  appServer: CodexAppServer,
  onValidationDiagnostic?: (diagnostic: ProviderValidationDiagnostic) => void,
): CodexAppServerProvider {
  return new CodexAppServerProvider({
    appServer,
    ...(onValidationDiagnostic === undefined ? {} : { onValidationDiagnostic }),
    schemaRepository: new ModelSchemaRepository({
      schemaDirectory: "/Applications/Huayi/provider/schemas",
    }),
  });
}

function successfulRun(content: unknown): FakeRun {
  const text = JSON.stringify(content);
  return { deltas: [text], finalText: text };
}

async function expectInvalidResponse(text: string): Promise<void> {
  const appServer = new FakeAppServer([{ deltas: [text], finalText: text }]);
  await expect(
    createProvider(appServer).analyze(createRequest(), new AbortController().signal),
  ).rejects.toMatchObject({ code: "INVALID_RESPONSE", retryable: true });
}

function emptyWordContent(
  action: AnalyzeRequest["action"],
  contextualMeaningZh: string,
  partOfSpeech: string,
  baseForm: string | null,
) {
  return action === "translate"
    ? {
        pronunciation: null,
        contextualSense: { meaningZh: contextualMeaningZh, partOfSpeech },
        dictionaryForm: baseForm ?? "test",
        commonMeanings: [{ meaningsZh: [contextualMeaningZh], partOfSpeech }],
        commonPhrases: [],
        confusableWords: [],
      }
    : {
        contextualAnalysisZh: contextualMeaningZh,
        wordForm: {
          baseForm: baseForm ?? "test",
          formTypeZh: "测试词形",
          sentenceRoleZh: null,
        },
        wordFormationZh: null,
        usageNotes: [],
        synonyms: [],
      };
}

beforeEach(() => {
  readFileMock.mockReset();
  readFileMock.mockImplementation(async (path: string) =>
    JSON.stringify({ additionalProperties: false, source: path, type: "object" }),
  );
});

describe("CodexAppServerProvider", () => {
  it.each([
    {
      chunks: [{ delta: "第一句。\n第二句。", section: "translation", type: "analysis-delta" }],
      request: createRequest({
        context: "First sentence.\nSecond sentence.",
        selection: "First sentence.\nSecond sentence.",
        selectionKind: "paragraph",
        sentenceContext: null,
      }),
      content: passageTranslationContent,
      schema: "translate-passage.json",
      type: "translate-passage",
    },
    {
      chunks: [
        {
          delta: "He said ... and urged anyone ...",
          section: "main-structure",
          type: "analysis-delta",
        },
        { delta: "他说调查仍处于早期阶段。", section: "translation", type: "analysis-delta" },
        {
          delta: "说明调查阶段并发出征集线索的呼吁。",
          section: "context-role",
          type: "analysis-delta",
        },
      ],
      request: createRequest({
        action: "explain",
        selection: "He said the investigation was in its early stages.",
        selectionKind: "sentence",
        sentenceContext: null,
      }),
      content: sentenceExplanationContent,
      schema: "explain-sentence.json",
      type: "explain-sentence",
    },
  ])("streams and validates $type", async ({ chunks, content, request, schema, type }) => {
    const appServer = new FakeAppServer([successfulRun(content)]);
    const provider = createProvider(appServer);
    const streamed: AnalysisStreamUpdate[] = [];

    const result = await provider.analyze(request, new AbortController().signal, (chunk) =>
      streamed.push(chunk),
    );

    expect(result).toMatchObject({
      selectionKind: request.selectionKind,
      sourceText: request.selection,
      type,
    });
    expect(streamed).toEqual(chunks);
    expect(readFileMock).toHaveBeenCalledWith(
      join("/Applications/Huayi/provider/schemas", schema),
      "utf8",
    );
  });

  it("emits a configured field incrementally without request metadata", async () => {
    const finalText = JSON.stringify(wordExplanationContent);
    const appServer = new FakeAppServer([
      {
        deltas: [
          '{"contextualAnalysisZh":"此处指正式',
          finalText.slice('{"contextualAnalysisZh":"此处指正式'.length),
        ],
        finalText,
      },
    ]);
    const chunks: AnalysisStreamUpdate[] = [];

    await createProvider(appServer).analyze(
      createRequest({ action: "explain" }),
      new AbortController().signal,
      (chunk) => chunks.push(chunk),
    );

    const deltas = chunks.filter((update) => update.type === "analysis-delta");
    expect(deltas).toEqual([
      { delta: "此处指正式", section: "contextual-analysis", type: "analysis-delta" },
      {
        delta: "调查，因为它作宾语从句的主语。",
        section: "contextual-analysis",
        type: "analysis-delta",
      },
    ]);
    expect(deltas.every((chunk) => Object.keys(chunk).length === 3)).toBe(true);
  });

  it("streams complete validated lexical sections before the final trusted result", async () => {
    const appServer = new FakeAppServer([successfulRun(lexicalTranslationContent)]);
    const updates: AnalysisStreamUpdate[] = [];

    const result = await createProvider(appServer).analyze(
      createRequest(),
      new AbortController().signal,
      (update) => updates.push(update),
    );

    expect(updates).toEqual([
      {
        section: "pronunciation",
        type: "analysis-section",
        value: { uk: "/ɪnˌvestɪˈɡeɪʃn/" },
      },
      {
        section: "contextual-sense",
        type: "analysis-section",
        value: { meaningZh: "调查行为", partOfSpeech: "noun" },
      },
      {
        section: "common-meanings",
        type: "analysis-section",
        value: [{ meaningsZh: ["调查", "侦查"], partOfSpeech: "noun" }],
      },
      {
        section: "common-phrases",
        type: "analysis-section",
        value: [{ meaningZh: "刑事调查", text: "criminal investigation" }],
      },
    ]);
    expect(result).toMatchObject({ sourceText: "investigation", type: "translate-word" });
  });

  it("interrupts once at the first invalid complete field and suppresses every late update", async () => {
    const diagnostics: ProviderValidationDiagnostic[] = [];
    const appServer = new FakeAppServer([
      {
        deltas: [
          '{"contextualAnalysisZh":"safe preview",',
          '"wordForm":{"baseForm":"investigation","formTypeZh":"测试","sentenceRoleZh":42}',
          ',"usageNotes":[]}',
        ],
        finalText: JSON.stringify(wordExplanationContent),
      },
    ]);
    const updates: AnalysisStreamUpdate[] = [];

    await expect(
      createProvider(appServer, (diagnostic) => diagnostics.push(diagnostic)).analyze(
        createRequest({ action: "explain" }),
        new AbortController().signal,
        (update) => updates.push(update),
      ),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE", retryable: true });

    expect(updates).toEqual([
      { delta: "safe preview", section: "contextual-analysis", type: "analysis-delta" },
    ]);
    expect(diagnostics).toEqual([{ field: "wordForm", stage: "model-schema" }]);
    expect(appServer.interruptCalls).toEqual(["analysis-1"]);
    expect(appServer.interruptCountsAfterDelta).toEqual([0, 1, 1]);
  });

  it("prefers a recorded INVALID_RESPONSE when interruption rejects the turn as cancelled", async () => {
    const appServer = new FakeAppServer([
      {
        deltas: ['{"contextualSense":{"meaningZh":"调查","partOfSpeech":"secret"}'],
        error: new CodexProviderError("CANCELLED", "cancelled", false),
        finalText: "",
      },
    ]);

    await expect(
      createProvider(appServer).analyze(createRequest(), new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE", retryable: true });
    expect(appServer.interruptCalls).toEqual(["analysis-1"]);
  });

  it("loads and parses each selected schema filename only once", async () => {
    const first = successfulRun(lexicalTranslationContent);
    const second = successfulRun(lexicalTranslationContent);
    const appServer = new FakeAppServer([first, second]);
    const provider = createProvider(appServer);

    await provider.analyze(createRequest(), new AbortController().signal);
    await provider.analyze(
      createRequest({ requestId: "analysis-2" }),
      new AbortController().signal,
    );

    expect(readFileMock).toHaveBeenCalledTimes(1);
    expect(appServer.requests[0]?.outputSchema).toBe(appServer.requests[1]?.outputSchema);
  });

  it("rejects malformed final JSON", () => expectInvalidResponse("not json"));

  it.each(["sourceText", "selectionKind", "type"])(
    "rejects model-owned public metadata %s",
    (field) =>
      expectInvalidResponse(JSON.stringify({ ...lexicalTranslationContent, [field]: "x" })),
  );

  it("rejects a malformed streamed object even when the final response is valid", async () => {
    const appServer = new FakeAppServer([
      {
        deltas: ['{"dictionaryForm":"one","dictionaryForm":"two"}'],
        finalText: JSON.stringify(lexicalTranslationContent),
      },
    ]);

    await expect(
      createProvider(appServer).analyze(createRequest(), new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(appServer.interruptCalls).toEqual(["analysis-1"]);
  });

  it.each([
    ["sustained", "translate", "adjective", null],
    ["sustained", "explain", "adjective", "sustain"],
    ["victims", "translate", "noun", null],
    ["victims", "explain", "noun", "victim"],
    ["accountable", "translate", "adjective", null],
    ["accountable", "explain", "adjective", null],
    ["Four", "translate", "number", null],
    ["Four", "explain", "number", null],
  ] as const)(
    "assembles reliable %s %s results from private model JSON",
    async (selection, action, partOfSpeech, baseForm) => {
      const content = emptyWordContent(action, `语境中的 ${selection}`, partOfSpeech, baseForm);
      const appServer = new FakeAppServer([successfulRun(content)]);
      const request = createRequest({ action, selection, sentenceContext: null });

      const result = await createProvider(appServer).analyze(request, new AbortController().signal);

      expect(result).toMatchObject({
        selectionKind: request.selectionKind,
        sourceText: request.selection,
        type: `${action}-word`,
      });
      if (action === "translate") {
        expect(result).toMatchObject({ commonPhrases: [], confusableWords: [] });
      } else {
        expect(result).toMatchObject({ synonyms: [], usageNotes: [] });
        expect(result).toHaveProperty("wordForm.baseForm", baseForm ?? "test");
      }
    },
  );
});
