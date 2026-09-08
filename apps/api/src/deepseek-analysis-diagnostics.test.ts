import { compactAnalysisFixture as output } from "./test-support/compact-analysis-fixture.js";
import { contractFixtures, webDeepAnalysisSchema } from "@huayi/cloud-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v3";

import { reportDeepSeekAnalysisOutputInvalid } from "./deepseek-analysis-diagnostics.js";
import { createDeepSeekAnalysisModel } from "./deepseek-analysis-model.js";

const prices = {
  cachedInputMicroUsdPerMillionTokens: 500_000,
  inputMicroUsdPerMillionTokens: 1_000_000,
  outputMicroUsdPerMillionTokens: 2_000_000,
};
const command = {
  input: contractFixtures.startAnalysisRequest,
  sentences: [{ analysisUnitId: "u1", ordinal: 0, sourceText: "To be frank, this works." }],
};

function response(content: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          index: 0,
          message: {
            content: typeof content === "string" ? content : JSON.stringify(content),
            role: "assistant",
          },
        },
      ],
      created: 1,
      id: "never-log-provider-id",
      model: "deepseek-v4-flash",
      object: "chat.completion",
      usage: {
        completion_tokens: 200,
        prompt_cache_hit_tokens: 20,
        prompt_tokens: 100,
        total_tokens: 300,
      },
    }),
    { headers: { "content-type": "application/json" }, status: 200 },
  );
}
function issue(path: (string | number)[], code = "custom"): z.ZodIssue {
  return { code, path, message: "private model text" } as z.ZodIssue;
}
function union(issues: z.ZodIssue[]): z.ZodIssue {
  return {
    code: "invalid_union",
    path: ["result"],
    message: "private union",
    unionErrors: [new z.ZodError(issues)],
  };
}

afterEach(() => vi.restoreAllMocks());

describe("safe Web analysis output diagnostics", () => {
  it("logs only fixed fields, codes and redacted bounded paths as one JSON string", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    reportDeepSeekAnalysisOutputInvalid("output-schema", "repair", [
      issue(["result", "sentences", 987654, "grammar", 0, "explanationZh"], "invalid_type"),
      {
        ...issue(["private-key", "__proto__"], "unrecognized_keys"),
        keys: ["never-log-key"],
      } as z.ZodIssue,
      issue(["candidates", 0, "payload"], "secret-code"),
    ]);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        event: "deepseek_analysis_output_invalid",
        stage: "output-schema",
        attempt: "repair",
        issues: [
          {
            path: ["result", "sentences", "*", "grammar", "*", "explanationZh"],
            code: "invalid_type",
          },
          { path: ["[redacted]", "[redacted]"], code: "unrecognized_keys" },
          { path: ["candidates", "*", "payload"], code: "unknown" },
        ],
        truncated: false,
      }),
    );
  });

  it("exposes known failing fields in real nested union errors without outputting values", () => {
    const sink = vi.fn();
    const parsed = webDeepAnalysisSchema.safeParse({
      type: "sentence-passage-analysis-v2",
      overall: { translationZh: "译文", understandingZh: "理解" },
      sentences: [
        {
          analysisUnitId: "u1",
          ordinal: 0,
          sourceText: "private original",
          candidateIds: [],
          expressions: [],
          grammar: [{ label: "private label", explanationZh: 123456 }],
          languageNotes: [],
          structure: [],
          translationZh: "译文",
        },
      ],
    });
    if (parsed.success) throw new Error("Expected invalid fixture");
    reportDeepSeekAnalysisOutputInvalid("output-schema", "first", parsed.error.issues, sink);
    expect(sink.mock.calls[0]?.[0].issues).toContainEqual({
      path: ["sentences", "*", "grammar", "*", "explanationZh"],
      code: "invalid_type",
    });
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(/private|123456/);
  });

  it("maps only exact static custom rules to fixed labels", () => {
    const sink = vi.fn();
    reportDeepSeekAnalysisOutputInvalid(
      "content-schema",
      "first",
      [
        { ...issue([]), message: "Every candidate must be referenced once by its analysis unit." },
        { ...issue([]), message: "Unknown candidate reference." },
        { ...issue([]), message: "Unknown candidate reference. private suffix" },
      ],
      sink,
    );
    expect(sink.mock.calls[0]?.[0].issues).toEqual([
      { path: [], code: "custom", rule: "candidate-unit-reference" },
      { path: [], code: "custom", rule: "unknown-candidate-reference" },
      { path: [], code: "custom" },
    ]);
  });

  it("bounds depth, paths, breadth, visited issues and retained issues", () => {
    const sink = vi.fn();
    const cyclic = union([]);
    if (cyclic.code !== "invalid_union") throw new Error("Expected union");
    cyclic.unionErrors[0]?.issues.push(cyclic);
    reportDeepSeekAnalysisOutputInvalid("output-schema", "first", [cyclic], sink);
    expect(sink.mock.calls[0]?.[0].truncated).toBe(true);
    const branches = Array.from({ length: 100 }, () => new z.ZodError([issue(["result"])]));
    reportDeepSeekAnalysisOutputInvalid(
      "output-schema",
      "first",
      [{ code: "invalid_union", path: [], message: "private", unionErrors: branches }],
      sink,
    );
    expect(sink.mock.calls[1]?.[0].truncated).toBe(true);
    reportDeepSeekAnalysisOutputInvalid(
      "output-schema",
      "first",
      [
        issue(Array.from({ length: 1000 }, () => "result")),
        ...Array.from({ length: 1000 }, () => issue(["result"])),
      ],
      sink,
    );
    expect(sink.mock.calls[2]?.[0].issues[0]?.path).toHaveLength(8);
    expect(sink.mock.calls[2]?.[0].truncated).toBe(true);
    const fields = [
      "result",
      "candidates",
      "type",
      "overall",
      "sentences",
      "translationZh",
      "understandingZh",
      "grammar",
      "expressions",
      "structure",
      "languageNotes",
      "payload",
      "sourceText",
      "source",
      "ordinal",
      "candidateIds",
      "analysisUnitId",
    ];
    reportDeepSeekAnalysisOutputInvalid(
      "content-schema",
      "repair",
      fields.map((field) => issue([field])),
      sink,
    );
    expect(sink.mock.calls[3]?.[0].issues).toHaveLength(16);
    expect(sink.mock.calls[3]?.[0].truncated).toBe(true);
  });

  it("never lets a failed logger escape", () => {
    expect(() =>
      reportDeepSeekAnalysisOutputInvalid("json", "first", undefined, () => {
        throw new Error("logger unavailable");
      }),
    ).not.toThrow();
  });

  it("stops inspecting issues after the global limit and isolates diagnostic construction failures", () => {
    const sink = vi.fn();
    const unreadable = issue([]);
    Object.defineProperty(unreadable, "path", {
      get() {
        throw new Error("must not inspect this issue");
      },
    });
    reportDeepSeekAnalysisOutputInvalid(
      "output-schema",
      "first",
      [...Array.from({ length: 64 }, () => issue(["result"])), unreadable],
      sink,
    );
    expect(sink).toHaveBeenCalledExactlyOnceWith({
      event: "deepseek_analysis_output_invalid",
      stage: "output-schema",
      attempt: "first",
      issues: [{ path: ["result"], code: "custom" }],
      truncated: true,
    });
    expect(() =>
      reportDeepSeekAnalysisOutputInvalid("output-schema", "first", [unreadable], sink),
    ).not.toThrow();
    expect(sink).toHaveBeenCalledTimes(1);
  });
});

describe("Web model diagnostic integration", () => {
  it.each(["json", "output-schema", "unit-count", "content-schema"] as const)(
    "reports %s for first and repair while preserving both billed calls",
    async (stage) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const content = output();
      const invalid =
        stage === "json"
          ? "private invalid json"
          : stage === "output-schema"
            ? { candidates: [], result: {} }
            : content;
      const sentences = command.sentences;
      if (stage === "unit-count")
        content.result.sentences.push(...structuredClone(content.result.sentences));
      if (stage === "content-schema" && content.result.sentences[0]?.candidates[0])
        content.result.sentences[0].candidates[0].text = "foreign exact quote";
      const fetch = vi.fn(async () => response(invalid));
      await expect(
        createDeepSeekAnalysisModel({ apiKey: "never-log-key", fetch, prices }).analyze({
          ...command,
          sentences,
        }),
      ).rejects.toMatchObject({
        code: "model_output_invalid",
        usageCostMicroUsd: 980,
        usage: { cachedInputTokens: 40, inputTokens: 200, outputTokens: 400 },
        billedCalls: [
          {
            costMicroUsd: 490,
            usage: { cachedInputTokens: 20, inputTokens: 100, outputTokens: 200 },
          },
          {
            costMicroUsd: 490,
            usage: { cachedInputTokens: 20, inputTokens: 100, outputTokens: 200 },
          },
        ],
      });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls.map(([line]) => JSON.parse(line as string))).toEqual([
        expect.objectContaining({
          event: "deepseek_analysis_output_invalid",
          stage,
          attempt: "first",
        }),
        expect.objectContaining({
          event: "deepseek_analysis_output_invalid",
          stage,
          attempt: "repair",
        }),
      ]);
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private|never-log|To be frank/);
    },
  );

  it.each([false, true])(
    "preserves repair and billing when the logger throws (repair valid: %s)",
    async (validRepair) => {
      vi.spyOn(console, "warn").mockImplementation(() => {
        throw new Error("logger unavailable");
      });
      const fetch = vi
        .fn()
        .mockImplementationOnce(async () => response("bad json"))
        .mockImplementationOnce(async () => response(validRepair ? output() : "bad json again"));
      const promise = createDeepSeekAnalysisModel({
        apiKey: "never-log-key",
        fetch,
        prices,
      }).analyze(command);
      if (validRepair) await expect(promise).resolves.toMatchObject({ usageCostMicroUsd: 980 });
      else
        await expect(promise).rejects.toMatchObject({
          code: "model_output_invalid",
          usageCostMicroUsd: 980,
        });
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it("emits nothing for a valid first result or a provider envelope failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      createDeepSeekAnalysisModel({
        apiKey: "key",
        fetch: async () => response(output()),
        prices,
      }).analyze(command),
    ).resolves.toMatchObject({ usageCostMicroUsd: 490 });
    await expect(
      createDeepSeekAnalysisModel({
        apiKey: "key",
        fetch: async () => new Response("private", { status: 503 }),
        prices,
      }).analyze(command),
    ).rejects.toMatchObject({ code: "model_unavailable" });
    expect(warn).not.toHaveBeenCalled();
  });
});
