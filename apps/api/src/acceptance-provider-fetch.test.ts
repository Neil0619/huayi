import { analysisContentSchema, modelUsageSchema } from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";

import { createDeepSeekAnalysisModel } from "./deepseek-analysis-model.js";
import { createDeepSeekDuplicateSuggestionProvider } from "./deepseek-duplicate-suggestion-provider.js";
import { createDeepSeekExtensionQueryModel } from "./deepseek-extension-query-model.js";
import { createDeepSeekPracticeProvider } from "./deepseek-practice-provider.js";
import { practiceGenerationOutputSchema } from "./paid-practice-generator.js";
import {
  buildDeepSeekAnalysisRequest,
  DEEPSEEK_PLATFORM_ENDPOINT,
  type DeepSeekAnalysisFetchInit,
} from "./deepseek-analysis-protocol.js";
import {
  acceptanceProviderFetch,
  LOCAL_ACCEPTANCE_PROVIDER_KEY,
} from "./acceptance-provider-fetch.js";

const prices = {
  cachedInputMicroUsdPerMillionTokens: 1,
  inputMicroUsdPerMillionTokens: 2,
  outputMicroUsdPerMillionTokens: 3,
};
const itemContent = {
  meaningZh: "示例含义",
  text: "to be frank",
  type: "expression" as const,
  usageZh: "示例用法。",
};

function init(body: string): DeepSeekAnalysisFetchInit {
  return {
    body,
    credentials: "omit",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${LOCAL_ACCEPTANCE_PROVIDER_KEY}`,
      "Content-Type": "application/json",
    },
    method: "POST",
    redirect: "error",
    signal: new AbortController().signal,
  };
}

function validAnalysisBody(): string {
  return buildDeepSeekAnalysisRequest(
    {
      selectionKind: "phrase",
      source: { type: "manual" },
      sourceText: "to be frank",
    },
    [{ analysisUnitId: "u1", ordinal: 0, sourceText: "to be frank" }],
  );
}

describe("local acceptance simulated provider", () => {
  it("never calls global fetch and returns byte-stable responses", async () => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    try {
      const body = validAnalysisBody();
      const first = await acceptanceProviderFetch(DEEPSEEK_PLATFORM_ENDPOINT, init(body));
      const second = await acceptanceProviderFetch(DEEPSEEK_PLATFORM_ENDPOINT, init(body));
      expect(await first.text()).toBe(await second.text());
      expect(network).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ["credentials", { ...init(validAnalysisBody()), credentials: "include" }],
    ["redirect", { ...init(validAnalysisBody()), redirect: "follow" }],
    [
      "accept",
      {
        ...init(validAnalysisBody()),
        headers: { ...init(validAnalysisBody()).headers, Accept: "text/plain" },
      },
    ],
    [
      "content type",
      {
        ...init(validAnalysisBody()),
        headers: { ...init(validAnalysisBody()).headers, "Content-Type": "text/plain" },
      },
    ],
  ])("fails closed for invalid %s transport configuration", async (_name, request) => {
    await expect(
      acceptanceProviderFetch(
        DEEPSEEK_PLATFORM_ENDPOINT,
        request as unknown as DeepSeekAnalysisFetchInit,
      ),
    ).rejects.toThrow("Local acceptance model request is invalid.");
  });

  it("fails closed for oversized and unknown prompts", async () => {
    await expect(
      acceptanceProviderFetch(DEEPSEEK_PLATFORM_ENDPOINT, init("x".repeat(64 * 1_024 + 1))),
    ).rejects.toThrow("Local acceptance model request is invalid.");

    const unknown = JSON.parse(validAnalysisBody()) as {
      messages: { content: string; role: "system" | "user" }[];
    };
    if (unknown.messages[0] !== undefined) unknown.messages[0].content = "Unknown local prompt.";
    await expect(
      acceptanceProviderFetch(DEEPSEEK_PLATFORM_ENDPOINT, init(JSON.stringify(unknown))),
    ).rejects.toThrow("Local acceptance model request is invalid.");
  });

  it.each([
    ["wrong endpoint", "https://example.invalid/chat", init("{}")],
    ["invalid json", DEEPSEEK_PLATFORM_ENDPOINT, init("not-json")],
    [
      "wrong authorization",
      DEEPSEEK_PLATFORM_ENDPOINT,
      { ...init("{}"), headers: { ...init("{}").headers, Authorization: "Bearer wrong" } },
    ],
    [
      "wrong method",
      DEEPSEEK_PLATFORM_ENDPOINT,
      { ...init("{}"), method: "GET" } as unknown as DeepSeekAnalysisFetchInit,
    ],
  ])("fails closed for %s", async (_name, url, request) => {
    await expect(acceptanceProviderFetch(url, request)).rejects.toThrow(
      "Local acceptance model request is invalid.",
    );
  });

  it("fails closed when the caller signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      acceptanceProviderFetch(DEEPSEEK_PLATFORM_ENDPOINT, {
        ...init("{}"),
        signal: controller.signal,
      }),
    ).rejects.toThrow("Local acceptance model request is invalid.");
  });

  it.each(["phrase", "sentence", "passage"] as const)(
    "drives %s Web analysis through the production adapter",
    async (selectionKind) => {
      const sourceText = selectionKind === "phrase" ? "to be frank" : "To be frank, this works.";
      const model = createDeepSeekAnalysisModel({
        apiKey: LOCAL_ACCEPTANCE_PROVIDER_KEY,
        fetch: acceptanceProviderFetch,
        prices,
      });
      const generated = await model.analyze({
        input: { selectionKind, source: { type: "manual" }, sourceText },
        sentences: [{ analysisUnitId: "u1", ordinal: 0, sourceText }],
      });
      const content = analysisContentSchema.parse(generated.content);
      const usage = modelUsageSchema.parse(generated.usage);

      expect(content.candidates).toHaveLength(1);
      expect(JSON.stringify(content.result)).toContain("【本机模拟】");
      expect(generated.billedCalls).toHaveLength(1);
      expect(usage.inputTokens).toBeGreaterThan(0);
      expect(usage.outputTokens).toBeGreaterThan(0);
    },
  );

  it.each([
    ["translate", "word", "translate-word"],
    ["explain", "word", "explain-word"],
    ["translate", "phrase", "translate-lexical"],
    ["explain", "phrase", "explain-lexical"],
    ["translate", "sentence", "translate-passage"],
    ["explain", "sentence", "explain-sentence"],
  ] as const)("drives %s %s ExtensionQuery", async (action, selectionKind, type) => {
    const model = createDeepSeekExtensionQueryModel({
      apiKey: LOCAL_ACCEPTANCE_PROVIDER_KEY,
      fetch: acceptanceProviderFetch,
      prices,
    });
    const generated = await model.run(
      {
        action,
        selectionKind,
        sourceText:
          selectionKind === "word"
            ? "frank"
            : selectionKind === "phrase"
              ? "to be frank"
              : "To be frank, this works.",
        sourceType: "web-selection",
      },
      "generation-1",
    );
    expect(generated.result.type).toBe(type);
    expect(JSON.stringify(generated.result)).toContain("【本机模拟】");
  });

  it("returns only a supplied duplicate candidate alias", async () => {
    const provider = createDeepSeekDuplicateSuggestionProvider({
      apiKey: LOCAL_ACCEPTANCE_PROVIDER_KEY,
      fetch: acceptanceProviderFetch,
      prices,
    });
    await expect(
      provider.generate({
        candidates: [{ alias: "candidate-1", content: itemContent }],
        source: { content: { ...itemContent, text: "frankly speaking" } },
      }),
    ).resolves.toMatchObject({
      suggestions: [
        { alias: "candidate-1", confidence: 0.91, reasonZh: expect.stringContaining("本机模拟") },
      ],
    });
  });

  it.each([
    ["sentence-prompt", { itemContent }],
    ["sentence-feedback", { answer: "I was frank.", itemContent, prompt: "Create a sentence." }],
    ["dialogue-start", { items: [{ content: itemContent, itemAlias: "item-1" }] }],
    [
      "dialogue-assistant",
      {
        items: [{ content: itemContent, itemAlias: "item-1" }],
        session: {
          dialoguePlan: { endConditionZh: "完成任务。", roleZh: "同事", taskZh: "讨论计划。" },
          prompt: "Start.",
          turns: [{ content: "Hello.", role: "assistant" }],
        },
      },
    ],
    [
      "dialogue-final-feedback",
      {
        items: [
          { content: itemContent, itemAlias: "item-1" },
          { content: { ...itemContent, text: "it works" }, itemAlias: "item-2" },
        ],
        session: {
          dialoguePlan: { endConditionZh: "完成任务。", roleZh: "同事", taskZh: "讨论计划。" },
          prompt: "Start.",
          turns: [{ content: "Hello.", role: "assistant" }],
        },
      },
    ],
  ] as const)("drives %s practice generation", async (kind, input) => {
    const provider = createDeepSeekPracticeProvider({
      apiKey: LOCAL_ACCEPTANCE_PROVIDER_KEY,
      fetch: acceptanceProviderFetch,
      prices,
    });
    const generated = await provider.generate({ input, kind });
    const output = practiceGenerationOutputSchema.parse(generated.output);
    expect(output.kind).toBe(kind);
    expect(JSON.stringify(output)).toContain("【本机模拟】");
    if (output.kind === "dialogue-final-feedback") {
      expect(output.itemFeedbacks.map((item) => item.itemAlias)).toEqual(["item-1", "item-2"]);
    }
  });
});
