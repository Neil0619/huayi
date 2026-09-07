import { describe, expect, it, vi } from "vitest";

import {
  createDeepSeekPracticeProvider,
  deepSeekPracticeMaximumUsage,
} from "./deepseek-practice-provider.js";
import type { DeepSeekAnalysisFetch } from "./deepseek-analysis-protocol.js";

const prices = {
  cachedInputMicroUsdPerMillionTokens: 500_000,
  inputMicroUsdPerMillionTokens: 1_000_000,
  outputMicroUsdPerMillionTokens: 2_000_000,
};
const input = {
  itemContent: {
    meaningZh: "坦率地说",
    text: "to be frank",
    type: "expression" as const,
    usageZh: "表达意见。",
  },
};
const plan = {
  roleZh: "正在讨论读书计划的朋友",
  taskZh: "说明你每天能为英语阅读腾出的时间。",
  endConditionZh: "完成三轮回复后总结计划。",
};
const dialogueInput = {
  items: [{ content: input.itemContent, itemAlias: "item-1" as const }],
};
const dialogueSession = {
  dialoguePlan: plan,
  prompt: "和朋友讨论英语阅读计划。",
  turns: [{ role: "assistant" as const, content: "How much time can you make for reading?" }],
};

function response(content: unknown, inputTokens = 100, outputTokens = 50) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          index: 0,
          message: {
            content: JSON.stringify(content),
            reasoning_content: "private",
            role: "assistant",
          },
        },
      ],
      model: "deepseek-v4-flash",
      usage: {
        completion_tokens: outputTokens,
        prompt_cache_hit_tokens: 0,
        prompt_tokens: inputTokens,
        total_tokens: inputTokens + outputTokens,
      },
    }),
    { headers: { "content-type": "application/json" }, status: 200 },
  );
}

describe("DeepSeek practice provider", () => {
  it.each([
    {
      kind: "sentence-prompt" as const,
      input: {
        itemContent: {
          type: "expression",
          text: "every day",
          meaningZh: "每天",
          usageZh: "说明频率。",
        },
      },
      english: {
        kind: "sentence-prompt",
        prompt: "Please write a sentence using 'every day' to describe something you do daily.",
      },
      chinese: {
        kind: "sentence-prompt",
        prompt: "你想养成阅读习惯。请用 every day 告诉朋友，你每天早餐前读一页英文书。",
      },
    },
    {
      kind: "sentence-feedback" as const,
      input: {
        ...input,
        answer: "To be frank, I need more time to read.",
        prompt: "请向朋友坦率说明你需要更多阅读时间。",
      },
      english: {
        kind: "sentence-feedback",
        feedback: "Your sentence is correct and natural. Well done!",
      },
      chinese: {
        kind: "sentence-feedback",
        feedback: "表达自然，to be frank 正确引出了坦率的个人看法。",
      },
    },
    {
      kind: "dialogue-start" as const,
      input: dialogueInput,
      english: {
        kind: "dialogue-start",
        prompt: "Discuss your reading plan with a friend.",
        opener: "How much time can you make for reading?",
        plan,
      },
      chinese: {
        kind: "dialogue-start",
        prompt: dialogueSession.prompt,
        opener: "How much time can you make for reading?",
        plan,
      },
    },
    {
      kind: "dialogue-final-feedback" as const,
      input: { ...dialogueInput, session: dialogueSession },
      english: {
        kind: "dialogue-final-feedback",
        summary: "你清楚地说明了阅读计划。",
        itemFeedbacks: [{ itemAlias: "item-1", feedback: "You used the expression naturally." }],
      },
      chinese: {
        kind: "dialogue-final-feedback",
        summary: "你清楚地说明了阅读计划。",
        itemFeedbacks: [
          { itemAlias: "item-1", feedback: "你自然地使用了 to be frank 来坦率表达想法。" },
        ],
      },
    },
  ])("repairs English learner guidance before accepting $kind", async (sample) => {
    const fetch = vi
      .fn<DeepSeekAnalysisFetch>()
      .mockResolvedValueOnce(response(sample.english))
      .mockResolvedValueOnce(response(sample.chinese));
    const provider = createDeepSeekPracticeProvider({ apiKey: "test-key", fetch, prices });
    await expect(provider.generate({ input: sample.input, kind: sample.kind })).resolves.toEqual({
      billedCalls: [
        { costMicroUsd: 200, usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 50 } },
        { costMicroUsd: 200, usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 50 } },
      ],
      output: sample.chinese,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("fails closed and bills both attempts when a guided prompt remains English", async () => {
    const fetch = vi.fn<DeepSeekAnalysisFetch>(async () =>
      response({ kind: "sentence-prompt", prompt: "Please write an English sentence." }),
    );
    const provider = createDeepSeekPracticeProvider({ apiKey: "test-key", fetch, prices });
    await expect(provider.generate({ input, kind: "sentence-prompt" })).rejects.toMatchObject({
      stableErrorCode: "model_output_invalid",
      billedCalls: [{ costMicroUsd: 200 }, { costMicroUsd: 200 }],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps actual dialogue turns in English without a language repair", async () => {
    const output = {
      kind: "dialogue-assistant",
      assistantTurn: "What would help you make more time for reading?",
    };
    const fetch = vi.fn<DeepSeekAnalysisFetch>(async () => response(output));
    const provider = createDeepSeekPracticeProvider({ apiKey: "test-key", fetch, prices });
    await expect(
      provider.generate({
        input: { ...dialogueInput, session: dialogueSession },
        kind: "dialogue-assistant",
      }),
    ).resolves.toMatchObject({ output });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("pins the provider request and sends only the bounded content input", async () => {
    const fetch = vi.fn<DeepSeekAnalysisFetch>(async () =>
      response({ kind: "sentence-prompt", prompt: "请用这个表达造句。" }),
    );
    const provider = createDeepSeekPracticeProvider({
      apiKey: "test-platform-key-that-is-never-logged",
      fetch,
      prices,
    });

    await expect(provider.generate({ input, kind: "sentence-prompt" })).resolves.toMatchObject({
      billedCalls: [{ costMicroUsd: 200 }],
      output: { kind: "sentence-prompt" },
    });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(init).toMatchObject({ credentials: "omit", method: "POST", redirect: "error" });
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    expect(body).toMatchObject({
      max_tokens: 1_024,
      model: "deepseek-v4-flash",
      reasoning_effort: "low",
      stream: true,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
    });
    expect(init?.body).not.toContain("ownerUserId");
    expect(init?.body).not.toContain("generationId");
    expect(init?.body).toContain("Write prompt in Simplified Chinese");
    expect(init?.body).toContain("one concrete everyday situation");
    expect(init?.body).toContain("do not supply the English answer");
    expect(
      JSON.stringify(await provider.generate({ input, kind: "sentence-prompt" })),
    ).not.toContain("private");
  });

  it("repairs structure once and exposes every billed call on final failure", async () => {
    const fetch = vi.fn<DeepSeekAnalysisFetch>(async () => response({ wrong: true }));
    const provider = createDeepSeekPracticeProvider({
      apiKey: "test-platform-key-that-is-never-logged",
      fetch,
      prices,
    });

    await expect(provider.generate({ input, kind: "sentence-prompt" })).rejects.toMatchObject({
      billedCalls: [{ costMicroUsd: 200 }, { costMicroUsd: 200 }],
      stableErrorCode: "model_output_invalid",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[1].body).toContain(
      "Repair the JSON structure and required language only",
    );
  });

  it("aborts a stalled provider at the configured deadline", async () => {
    let providerSignal: AbortSignal | undefined;
    const provider = createDeepSeekPracticeProvider({
      apiKey: "test-key",
      fetch: async (_url, init) => {
        providerSignal = init.signal;
        return new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
      prices,
      timeoutMs: 1,
    });

    await expect(provider.generate({ input, kind: "sentence-prompt" })).rejects.toMatchObject({
      stableErrorCode: "model_unavailable",
    });
    expect(providerSignal?.aborted).toBe(true);
  });

  it("reserves for at most two bounded calls", () => {
    expect(deepSeekPracticeMaximumUsage("dialogue-final-feedback")).toEqual({
      inputTokens: 131_072,
      outputTokens: 8_192,
    });
  });
});
